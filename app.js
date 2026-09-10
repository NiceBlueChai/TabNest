/** @file 管理界面使用安全 DOM 文本渲染，通过后台完成持久化、快照和恢复。 */
import {icon} from './icons.mjs';

const $ = selector => document.querySelector(selector);
let sessions = [];
let busy = false;
let renameTarget;
let deleteTarget;
let exportTarget;
let toastTimer;
const collapsed = new Set();
let selectedGroup = 'all';

function updateCollapseAll() {
    const lists = [...document.querySelectorAll('#records .group-list')];
    const allClosed = lists.length > 0 && lists.every(list => list.hidden);
    const label = allClosed ? '全部展开' : '全部折叠';
    const control = $('#collapse-all');
    control.disabled = lists.length === 0;
    control.setAttribute('aria-label', label);
    control.querySelector('span:last-child').textContent = label;
    control.querySelector('.icon').classList.toggle('is-closed', allClosed);
}

function groupKey(session, tab) {
    if (tab.groupId === null) {
        return 'ungrouped';
    }
    const group = session.groups.find(item => item.id === tab.groupId);
    return group?.title.trim() ? `name:${group.title.trim()}` : `unnamed:${session.id}/${tab.groupId}`;
}

function renderNavigation() {
    const entries = new Map();
    let ungrouped = 0;
    let total = 0;
    for (const session of sessions) {
        for (const tab of session.tabs) {
            total++;
            const key = groupKey(session, tab);
            if (key === 'ungrouped') {
                ungrouped++;
                continue;
            }
            if (!entries.has(key)) {
                const group = session.groups.find(item => item.id === tab.groupId);
                entries.set(key, {title: group?.title.trim() || '未命名分组', color: group?.color || 'grey', count: 0});
            }
            entries.get(key).count++;
        }
    }
    entries.set('ungrouped', {title: '未分组', color: 'grey', count: ungrouped});
    if (selectedGroup !== 'all' && !entries.has(selectedGroup)) {
        selectedGroup = 'all';
    }
    const all = $('#all-records');
    all.classList.toggle('active', selectedGroup === 'all');
    all.setAttribute('aria-current', selectedGroup === 'all' ? 'page' : 'false');
    $('#side-count').textContent = total;
    all.title = `全部收纳 · ${total} 个标签`;
    const container = $('#group-nav');
    const focusedKey = container.contains(document.activeElement) ? document.activeElement.dataset.groupKey : null;
    container.replaceChildren();
    for (const [key, entry] of entries) {
        const item = button('', `nav${selectedGroup === key ? ' active' : ''}`,
            `${entry.title} · ${entry.count} 个标签`, () => { selectedGroup = key; render(); });
        item.dataset.groupKey = key;
        item.setAttribute('aria-current', selectedGroup === key ? 'page' : 'false');
        item.append(node('span', `color-dot color-${entry.color}`), node('span', 'nav-title', entry.title),
            node('b', '', String(entry.count)));
        container.append(item);
        if (key === focusedKey) {
            item.focus({preventScroll: true});
        }
    }
    const title = selectedGroup === 'all' ? '全部收纳' : entries.get(selectedGroup).title;
    $('#current-view').textContent = title;
    $('#collection-title').textContent = selectedGroup === 'all' ? '我的收纳' : title;
}

function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) {
        element.className = className;
    }
    if (text !== undefined) {
        element.textContent = text;
    }
    return element;
}

function toast(text, error = false, undo) {
    clearTimeout(toastTimer);
    const target = $('#toast');
    target.textContent = text;
    if (undo) {
        target.append(button('撤销', 'undo-button', '撤销单条删除', undo));
    }
    target.classList.toggle('error', error);
    target.hidden = false;
    toastTimer = setTimeout(() => { target.hidden = true; }, undo ? 15000 : error ? 12000 : 6500);
}

async function send(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) {
        throw new Error(response?.error || '扩展连接中断，请重新打开管理页。');
    }
    return response.data;
}

async function act(operation) {
    if (busy) {
        return;
    }
    busy = true;
    document.querySelectorAll('button').forEach(button => { button.disabled = true; });
    try {
        await operation();
    } catch (error) {
        toast(error.message, true);
    } finally {
        busy = false;
        document.querySelectorAll('button').forEach(button => { button.disabled = false; });
    }
}

function button(text, className, label, callback, iconName) {
    const element = node('button', className, text);
    element.type = 'button';
    element.title = label;
    element.setAttribute('aria-label', label);
    element.disabled = busy;
    element.addEventListener('click', callback);
    if (iconName) {
        element.append(icon(iconName));
    }
    return element;
}

function iconButton(name, className, label, callback) {
    return button('', className, label, callback, name);
}

async function refresh() {
    sessions = await send({type: 'list'});
    render();
}

function rename(session, group) {
    renameTarget = {id: session.id, ...(group ? {groupId: group.id} : {})};
    $('#rename-input').value = group ? group.title : session.name;
    $('#rename-dialog').showModal();
    $('#rename-input').focus();
    $('#rename-input').select();
}

function restore(session, groupId, tabIndex) {
    act(async () => {
        const target = $('#restore-target').value;
        const destination = target === 'current' ? '当前窗口' : '新窗口';
        const window = await chrome.windows.getCurrent();
        toast(`正在${destination}恢复标签与分组…`);
        const result = await send({type: 'restore', id: session.id, groupId, tabIndex,
            target, windowId: window.id});
        toast(`已恢复 ${result.count} 个标签到${destination}，原收纳记录仍保留。`);
    });
}

function renderGroup(session, key, tabs, matched) {
    const group = session.groups.find(item => item.id === key);
    const block = node('section', 'group');
    const header = node('div', 'group-header');
    const collapseId = `${session.id}/${key}`;
    const isClosed = collapsed.has(collapseId) && !matched;
    const toggle = button('', 'group-name', '折叠或展开分组', () => {
        const close = !list.hidden;
        close ? collapsed.add(collapseId) : collapsed.delete(collapseId);
        list.hidden = close;
        toggle.setAttribute('aria-expanded', String(!close));
        toggle.querySelector('.chevron').classList.toggle('is-closed', close);
        updateCollapseAll();
    });
    toggle.setAttribute('aria-expanded', String(!isClosed));
    toggle.append(icon('chevron', `chevron${isClosed ? ' is-closed' : ''}`),
        node('span', `color-dot color-${group?.color || 'grey'}`),
        node('span', '', group ? group.title || '未命名分组' : '未分组'),
        node('span', 'group-count', String(tabs.length)));
    header.append(toggle);
    if (group) {
        header.append(iconButton('edit', 'icon-button', '重命名分组', () => rename(session, group)));
    }
    header.append(button('恢复此组', 'text-button', '按所选恢复位置打开完整分组',
        () => restore(session, key), 'external'));
    block.append(header);
    const list = node('div', 'group-list');
    list.dataset.collapseId = collapseId;
    list.hidden = isClosed;
    for (const tab of tabs) {
        const domain = new URL(tab.url).hostname || '本地文件';
        const row = node('div', 'tab-row');
        const link = node('a', 'tab-link', tab.title || tab.url);
        link.href = tab.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.title = `${tab.title}\n${tab.url}`;
        link.addEventListener('click', event => {
            if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) {
                return;
            }
            event.preventDefault();
            restore(session, undefined, session.tabs.indexOf(tab));
        });
        row.append(node('span', 'favicon', domain.replace(/^www\./, '').slice(0, 2).toUpperCase()), link);
        if (tab.pinned) {
            row.append(node('span', 'pin', '固定'));
        }
        row.append(node('span', 'tab-domain', domain));
        row.append(iconButton('trash', 'icon-button delete-tab', `删除标签：${tab.title || tab.url}`, () => {
            act(async () => {
                const {token} = await send({type: 'delete-tab', id: session.id,
                    tabIndex: session.tabs.indexOf(tab), expectedTab: tab});
                await refresh();
                toast('已删除这条收藏，浏览器中的页面不受影响。', false, () => {
                    act(async () => {
                        const result = await send({type: 'undo-delete-tab', token});
                        await refresh();
                        toast(result.alreadyExists ? '该网址已在收藏中，未重复添加。' : '已撤销删除。');
                    });
                });
            });
        }));
        list.append(row);
    }
    block.append(list);
    return block;
}

function render() {
    renderNavigation();
    const query = $('#search').value.trim().toLocaleLowerCase();
    const records = $('#records');
    records.replaceChildren();
    let found = 0;
    let visibleTabs = 0;
    for (const session of sessions) {
        const matchAll = session.name.toLocaleLowerCase().includes(query);
        const tabs = session.tabs.filter(tab => (selectedGroup === 'all' || groupKey(session, tab) === selectedGroup)
            && (matchAll || [tab.title, tab.url,
            session.groups.find(group => group.id === tab.groupId)?.title || ''].some(text =>
            text.toLocaleLowerCase().includes(query))));
        if (!tabs.length) {
            continue;
        }
        found++;
        visibleTabs += tabs.length;
        const card = node('article', 'record');
        const head = node('div', 'record-head');
        const title = node('div', 'record-title');
        const date = new Date(session.createdAt).toLocaleString('zh-CN', {hour12: false});
        title.append(node('h3', '', session.name), node('p', '',
            `${date}  ·  当前显示 ${tabs.length} 个标签`));
        const symbol = node('span', 'record-symbol');
        symbol.append(icon('archive'));
        head.append(symbol, title);
        // 分组视图不暴露整条记录的写操作，避免误处理隐藏的其他分组。
        if (selectedGroup === 'all') {
            head.append(
            iconButton('edit', 'icon-button', '重命名收纳', () => rename(session)),
            iconButton('download', 'icon-button', '导出此收纳', () => {
                exportTarget = session.id;
                $('#export-dialog').showModal();
            }),
            iconButton('trash', 'icon-button', '删除收纳', () => {
                deleteTarget = session.id;
                $('#delete-dialog').showModal();
            }),
                button('恢复全部', 'button', '按所选恢复位置打开此收纳的全部标签',
                    () => restore(session), 'external'));
        }
        const body = node('div', 'record-body');
        for (const key of new Set(tabs.map(tab => tab.groupId))) {
            body.append(renderGroup(session, key, tabs.filter(tab => tab.groupId === key), Boolean(query)));
        }
        card.append(head, body);
        records.append(card);
    }
    $('#record-count').textContent = found;
    $('#stats').textContent = `共 ${visibleTabs} 个标签 · ${found} 条收纳记录 · 按保存时间排列`;
    $('#empty').hidden = found > 0;
    $('#empty h3').textContent = query ? '暂时没有找到匹配的收藏' : '从一组标签开始，找回清爽';
    $('#empty p').textContent = query ? '换一个关键词，试试页面标题、网址或分组名。'
        : '点击上方「全部收纳」，或选择一个已打开的标签或分组。';
    if (!query && selectedGroup === 'ungrouped') {
        $('#empty h3').textContent = '暂无未分组标签';
        $('#empty p').textContent = '没有加入浏览器分组的收藏，会单独显示在这里。';
    }
    updateCollapseAll();
}

async function capture(closeTabs) {
    await act(async () => {
        const window = await chrome.windows.getCurrent();
        const result = await send({type: 'capture', windowId: window.id,
            allWindows: $('#all-windows').checked, mergeGroups: $('#merge-groups').checked, closeTabs});
        await refresh();
        let message = result.count ? `新增 ${result.count} 个标签。` : '这些标签已收纳，没有重复添加。';
        if (result.duplicates) {
            message += `已跳过 ${result.duplicates} 个重复网址。`;
        }
        if (closeTabs) {
            message += '已处理所选原标签的关闭。';
        }
        if (result.skipped) {
            message += `已跳过 ${result.skipped} 个内部页或扩展页。`;
        }
        if (result.unclosed) {
            message += `${result.unclosed} 个标签已变化或无法关闭，存档已保留。`;
        }
        toast(message);
    });
}

$('#save-only').addEventListener('click', () => capture(false));
$('#collapse-all').addEventListener('click', () => {
    const lists = [...document.querySelectorAll('#records .group-list')];
    const close = lists.some(list => !list.hidden);
    for (const list of lists) {
        close ? collapsed.add(list.dataset.collapseId) : collapsed.delete(list.dataset.collapseId);
        list.hidden = close;
        const toggle = list.closest('.group').querySelector('.group-name');
        toggle.setAttribute('aria-expanded', String(!close));
        toggle.querySelector('.chevron').classList.toggle('is-closed', close);
    }
    updateCollapseAll();
});
$('#deduplicate').addEventListener('click', () => {
    act(async () => {
        const result = await send({type: 'deduplicate'});
        await refresh();
        toast(result.removed ? `已清理 ${result.removed} 个重复标签，相同网址保留一份。` : '没有重复网址。');
    });
});
$('#choose-open').addEventListener('click', () => {
    $('#choose-frame').src = 'popup.html';
    $('#choose-dialog').showModal();
});
$('#save-close').addEventListener('click', () => capture(true));
$('#search').addEventListener('input', render);
$('#all-records').addEventListener('click', () => {
    selectedGroup = 'all';
    $('#search').value = '';
    render();
});
$('#import-open').addEventListener('click', () => $('#import-dialog').showModal());
$('#export-open').addEventListener('click', () => {
    if (!sessions.length) {
        toast('先保存或导入一些标签，再导出备份。');
        return;
    }
    exportTarget = undefined;
    $('#export-dialog').showModal();
});
document.querySelectorAll('[data-dismiss]').forEach(element => {
    if (element.classList.contains('icon-button')) {
        element.replaceChildren(icon('close'));
    }
    element.addEventListener('click', () => element.closest('dialog').close());
});
$('#import-form').addEventListener('submit', event => {
    event.preventDefault();
    act(async () => {
        const file = $('#import-file').files[0];
        if (file?.size > 15 * 1024 * 1024) {
            throw new Error('导入文件不能超过 15 MB。');
        }
        const text = file ? await file.text() : $('#import-text').value;
        const result = await send({type: 'import', text, mergeGroups: $('#import-merge').checked});
        $('#import-dialog').close();
        $('#import-form').reset();
        selectedGroup = 'all';
        $('#search').value = '';
        await refresh();
        toast(`新增 ${result.count} 个标签，补回 ${result.regrouped} 个标签的分组。`
            + `跳过 ${result.duplicates} 个重复网址、${result.skipped} 个内部页。`);
    });
});
$('#export-form').addEventListener('submit', event => {
    event.preventDefault();
    act(async () => {
        const format = new FormData(event.target).get('format');
        const data = await send({type: 'export', id: exportTarget, format});
        const url = URL.createObjectURL(new Blob([data], {type: format === 'json'
            ? 'application/json;charset=utf-8' : 'text/plain;charset=utf-8'}));
        const link = node('a');
        link.href = url;
        link.download = `TabNest-${new Date().toISOString().slice(0, 10)}.${format}`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        $('#export-dialog').close();
        toast('已生成备份下载。');
    });
});
$('#rename-form').addEventListener('submit', event => {
    event.preventDefault();
    act(async () => {
        await send({type: 'rename', ...renameTarget, name: $('#rename-input').value,
            mergeGroups: $('#merge-groups').checked});
        $('#rename-dialog').close();
        await refresh();
        toast('名称已更新。');
    });
});
$('#delete-form').addEventListener('submit', event => {
    event.preventDefault();
    act(async () => {
        await send({type: 'delete', id: deleteTarget});
        $('#delete-dialog').close();
        await refresh();
        toast('收纳记录已删除。');
    });
});

function setTheme(dark) {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    $('#theme').replaceChildren(icon(dark ? 'sun' : 'moon'),
        node('span', '', dark ? '切换浅色外观' : '切换深色外观'));
}
$('#restore-target').addEventListener('change', () => {
    act(async () => {
        await chrome.storage.local.set({restoreTarget: $('#restore-target').value});
    });
});
$('#merge-groups').addEventListener('change', () => {
    act(async () => {
        await chrome.storage.local.set({mergeGroups: $('#merge-groups').checked});
        $('#import-merge').checked = $('#merge-groups').checked;
    });
});
$('#theme').addEventListener('click', () => {
    act(async () => {
        const dark = document.documentElement.dataset.theme !== 'dark';
        await chrome.storage.local.set({dark});
        setTheme(dark);
    });
});
document.addEventListener('keydown', event => {
    if (event.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)
        && !document.querySelector('dialog[open]')) {
        event.preventDefault();
        $('#search').focus();
    }
});
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.sessions) {
        sessions = changes.sessions.newValue || [];
        render();
    }
    if (area === 'local' && changes.dark) {
        setTheme(changes.dark.newValue);
    }
    if (area === 'local' && changes.restoreTarget) {
        $('#restore-target').value = changes.restoreTarget.newValue === 'current' ? 'current' : 'new';
    }
    if (area === 'local' && changes.mergeGroups) {
        $('#merge-groups').checked = changes.mergeGroups.newValue !== false;
        $('#import-merge').checked = changes.mergeGroups.newValue !== false;
    }
});
document.querySelectorAll('[data-icon]').forEach(element => {
    element.replaceChildren(icon(element.dataset.icon));
});
act(async () => {
    const {dark, mergeGroups, restoreTarget} = await chrome.storage.local.get(['dark', 'mergeGroups', 'restoreTarget']);
    $('#restore-target').value = restoreTarget === 'current' ? 'current' : 'new';
    $('#merge-groups').checked = mergeGroups !== false;
    $('#import-merge').checked = mergeGroups !== false;
    setTheme(dark ?? matchMedia('(prefers-color-scheme: dark)').matches);
    await refresh();
});
