/** @file 扩展后台集中串行处理写入，先持久化快照再关闭标签，恢复失败保留原始存档。 */
import {snapshot, safeUrl, parseImport, exportBackup, mergeNamedGroups, deduplicate,
    regroupImported} from './model.mjs';

let queue = Promise.resolve();

async function readSessions() {
    const data = await chrome.storage.local.get('sessions');
    return data.sessions || [];
}

async function saveSessions(sessions) {
    await chrome.storage.local.set({sessions});
}

async function deleteTab(sessions, session, message) {
    const index = message.tabIndex;
    if (!Number.isInteger(index) || index < 0 || !session.tabs[index]
        || JSON.stringify(session.tabs[index]) !== JSON.stringify(message.expectedTab)) {
        throw new Error('该标签已变化，请刷新后重试。');
    }
    const tab = session.tabs[index];
    const token = crypto.randomUUID();
    const deletedTab = {token, tab, tabIndex: index, sessionIndex: sessions.indexOf(session),
        session: {id: session.id, name: session.name, createdAt: session.createdAt},
        group: session.groups.find(group => group.id === tab.groupId) || null,
        groupIndex: session.groups.findIndex(group => group.id === tab.groupId)};
    session.tabs.splice(index, 1);
    session.groups = session.groups.filter(group => session.tabs.some(item => item.groupId === group.id));
    if (!session.tabs.length) {
        sessions.splice(sessions.indexOf(session), 1);
    }
    // 删除内容与撤销信息一次写入，写入失败时两者均不生效。
    await chrome.storage.local.set({sessions, deletedTab});
    return {token};
}

async function undoDeleteTab(sessions, token) {
    const {deletedTab: saved} = await chrome.storage.local.get('deletedTab');
    if (!saved || saved.token !== token) {
        throw new Error('这次删除已无法撤销，只能撤销最近一次单条删除。');
    }
    const url = new URL(saved.tab.url).href;
    const exists = sessions.some(session => session.tabs.some(tab => new URL(tab.url).href === url));
    if (!exists) {
        let session = sessions.find(item => item.id === saved.session.id);
        if (!session) {
            session = {...saved.session, groups: [], tabs: []};
            sessions.splice(Math.min(saved.sessionIndex, sessions.length), 0, session);
        }
        if (saved.group && !session.groups.some(group => group.id === saved.group.id)) {
            session.groups.splice(Math.min(saved.groupIndex, session.groups.length), 0, saved.group);
        }
        session.tabs.splice(Math.min(saved.tabIndex, session.tabs.length), 0, saved.tab);
    }
    await chrome.storage.local.set({sessions, deletedTab: null});
    return {alreadyExists: exists};
}

async function addIncoming(incoming, mergeGroups, repairGroups = false) {
    let existing = await readSessions();
    let regrouped = 0;
    if (repairGroups) {
        ({existing, incoming, regrouped} = regroupImported(existing, incoming));
    }
    const seen = new Set(existing.flatMap(session => session.tabs.map(tab => new URL(tab.url).href)));
    const unique = deduplicate(incoming, seen);
    const combined = [...unique.sessions, ...existing];
    if (unique.sessions.length) {
        await saveSessions(mergeGroups === false ? combined : mergeNamedGroups(combined));
    }
    return {count: unique.sessions.reduce((sum, session) => sum + session.tabs.length, 0) - regrouped,
        duplicates: unique.removed, regrouped};
}

async function openManager(windowId, active = true) {
    const url = chrome.runtime.getURL('index.html');
    const existing = (await chrome.tabs.query({windowId}))
        .find(tab => (tab.pendingUrl || tab.url)?.split('?')[0] === url);
    if (existing) {
        if (active) {
            await chrome.tabs.update(existing.id, {active: true});
        }
        return existing;
    }
    return await chrome.tabs.create({windowId, url, active});
}

async function capture(message) {
    const scope = message.scope || 'window';
    if (!['tab', 'group', 'window'].includes(scope)) {
        throw new Error('收纳范围无效。');
    }
    const windows = scope === 'window' && message.allWindows
        ? await chrome.windows.getAll({windowTypes: ['normal']})
        : [await chrome.windows.get(message.windowId)];
    const captures = [];
    let skipped = 0;
    for (const window of windows.filter(item => !item.incognito)) {
        let tabs = await chrome.tabs.query({windowId: window.id});
        const groups = await chrome.tabGroups.query({windowId: window.id});
        if (scope === 'tab') {
            tabs = tabs.filter(tab => tab.id === message.tabId);
            if (!tabs.length) {
                throw new Error('所选标签已关闭或移到其他窗口，请重新选择。');
            }
        } else if (scope === 'group') {
            if (!Number.isInteger(message.groupId) || message.groupId < 0) {
                throw new Error('请先选择一个浏览器分组。');
            }
            tabs = tabs.filter(tab => tab.groupId === message.groupId);
            if (!tabs.length) {
                throw new Error('所选分组已关闭或移到其他窗口，请重新选择。');
            }
        }
        const name = new Intl.DateTimeFormat('zh-CN', {month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit'}).format(new Date());
        const label = scope === 'tab' ? tabs[0].title || '单个标签'
            : scope === 'group' ? groups.find(group => group.id === message.groupId)?.title || '未命名分组'
            : `${name} · 窗口 ${captures.length + 1}`;
        const session = snapshot(tabs, groups, label.slice(0, 200));
        skipped += tabs.filter(tab => !safeUrl(tab.pendingUrl || tab.url)).length;
        if (session) {
            captures.push({session, tabs: tabs.filter(tab => safeUrl(tab.pendingUrl || tab.url))});
        }
    }
    if (!captures.length) {
        throw new Error('没有可保存的网页。浏览器内部页、扩展页和隐私窗口不会保存。');
    }
    const added = await addIncoming(captures.map(item => item.session), message.mergeGroups);
    let unclosed = 0;
    if (message.closeTabs) {
        // 快捷收纳先留一个管理页，避免关闭最后一个标签导致整个窗口消失。
        if (message.openManager) {
            await openManager(message.windowId, false);
        }
        for (const capture of captures) {
            for (const tab of capture.tabs) {
                try {
                    const current = await chrome.tabs.get(tab.id);
                    if ((current.pendingUrl || current.url) === (tab.pendingUrl || tab.url)) {
                        await chrome.tabs.remove(tab.id);
                    } else {
                        unclosed++;
                    }
                } catch {
                    unclosed++;
                }
            }
        }
        if (message.openManager) {
            await openManager(message.windowId);
        }
    }
    return {...added, skipped, unclosed};
}

async function restore(session, groupId, tabIndex, message) {
    const tabs = Number.isInteger(tabIndex) ? [session.tabs[tabIndex]]
        : groupId !== undefined ? session.tabs.filter(tab => tab.groupId === groupId) : session.tabs;
    if (!tabs.length || tabs.some(tab => !tab || !safeUrl(tab.url))) {
        throw new Error('没有可恢复的标签。');
    }
    const target = message.target || 'new';
    if (!['new', 'current'].includes(target)) {
        throw new Error('请选择有效的恢复位置。');
    }
    const window = target === 'current' ? await chrome.windows.get(message.windowId)
        : await chrome.windows.create({url: 'about:blank', focused: true});
    if (window.incognito || window.type !== 'normal') {
        throw new Error('只能恢复到普通浏览器窗口。');
    }
    const grouped = new Map();
    let restored = 0;
    try {
        for (const tab of tabs) {
            const created = await chrome.tabs.create({windowId: window.id, url: tab.url,
                pinned: tab.pinned, active: false});
            restored++;
            if (tab.groupId !== null && !tab.pinned) {
                if (!grouped.has(tab.groupId)) {
                    grouped.set(tab.groupId, []);
                }
                grouped.get(tab.groupId).push(created.id);
            }
        }
        for (const [key, ids] of grouped) {
            const group = session.groups.find(item => item.id === key);
            const id = await chrome.tabs.group({tabIds: ids, createProperties: {windowId: window.id}});
            await chrome.tabGroups.update(id, {
                title: group.title, color: group.color, collapsed: group.collapsed
            });
        }
        if (target === 'new' && window.tabs?.[0]) {
            await chrome.tabs.remove(window.tabs[0].id);
        }
    } catch (error) {
        throw new Error(`恢复中断，已打开 ${restored} 个标签。存档仍保留，可重试。${error.message}`);
    }
    return {count: restored};
}

async function handle(message) {
    if (message.type === 'open-manager') {
        await openManager(message.windowId);
        return {};
    }
    if (message.type === 'list') {
        return await readSessions();
    }
    if (message.type === 'capture') {
        return await capture(message);
    }
    const sessions = await readSessions();
    if (message.type === 'undo-delete-tab') {
        return await undoDeleteTab(sessions, message.token);
    }
    if (message.type === 'deduplicate') {
        const unique = deduplicate(sessions);
        if (unique.removed) {
            await saveSessions(unique.sessions);
        }
        return {removed: unique.removed};
    }
    if (message.type === 'import') {
        const report = {};
        const imported = parseImport(message.text, report);
        const result = await addIncoming(imported, message.mergeGroups, report.format === 'text');
        return {...result, skipped: report.skipped};
    }
    const session = sessions.find(item => item.id === message.id);
    if (message.type === 'export') {
        if (message.id && !session) {
            throw new Error('记录已不存在，请刷新。');
        }
        return exportBackup(message.id ? [session] : sessions, message.format);
    }
    if (!session) {
        throw new Error('记录已不存在，请刷新。');
    }
    if (message.type === 'delete-tab') {
        return await deleteTab(sessions, session, message);
    }
    if (message.type === 'restore') {
        return await restore(session, message.groupId, message.tabIndex, message);
    }
    if (message.type === 'rename') {
        if (typeof message.name !== 'string' || !message.name.trim() || message.name.length > 200) {
            throw new Error('名称需为 1–200 个字符。');
        }
        if (message.groupId !== undefined) {
            const group = session.groups.find(item => item.id === message.groupId);
            if (!group) {
                throw new Error('分组不存在。');
            }
            group.title = message.name.trim();
        } else {
            session.name = message.name.trim();
        }
    } else if (message.type === 'delete') {
        sessions.splice(sessions.indexOf(session), 1);
    } else {
        throw new Error('不支持的操作。');
    }
    await saveSessions(message.type === 'rename' && message.groupId !== undefined && message.mergeGroups !== false
        ? mergeNamedGroups(sessions) : sessions);
    return {};
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) {
        return false;
    }
    const run = queue.then(() => handle(message));
    queue = run.catch(() => {});
    run.then(data => sendResponse({ok: true, data}), error => sendResponse({ok: false, error: error.message}));
    return true;
});
