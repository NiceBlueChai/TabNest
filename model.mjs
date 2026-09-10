/** @file 数据模型与备份校验，统一保存、导入和恢复允许的标签数据。 */
export const COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];

/** @brief 只接受能安全恢复的常规网页和文件链接。 */
export function safeUrl(value) {
    try {
        return typeof value === 'string' && value.length <= 32768
            && ['http:', 'https:', 'file:', 'ftp:'].includes(new URL(value).protocol);
    } catch {
        return false;
    }
}

/** @brief 按窗口快照保留标签顺序、固定状态及原生分组属性。 */
export function snapshot(tabs, groups, name) {
    const kept = tabs.filter(tab => safeUrl(tab.pendingUrl || tab.url)).sort((a, b) => a.index - b.index);
    if (!kept.length) {
        return null;
    }
    const groupIds = new Set(kept.map(tab => tab.groupId));
    return {
        id: crypto.randomUUID(), name, createdAt: new Date().toISOString(),
        groups: groups.filter(group => groupIds.has(group.id)).map(group => ({
            id: String(group.id), title: group.title || '', color: group.color, collapsed: group.collapsed
        })),
        tabs: kept.map(tab => ({
            title: tab.title || tab.pendingUrl || tab.url, url: tab.pendingUrl || tab.url,
            pinned: Boolean(tab.pinned), groupId: groups.some(group => group.id === tab.groupId)
                ? String(tab.groupId) : null
        }))
    };
}

/** @brief 从不可信 JSON 重新构造字段，拒绝损坏或危险内容且不覆盖已有数据。 */
export function validateBackup(data) {
    if (data?.format !== 'tabnest' || data.version !== 1 || !Array.isArray(data.sessions)
        || !data.sessions.length || data.sessions.length > 2000) {
        throw new Error('不是受支持的 TabNest v1 备份，或备份为空。');
    }
    let total = 0;
    const string = (value, max) => typeof value === 'string' && value.length <= max;
    return data.sessions.map(session => {
        if (!session || !string(session.name, 200) || !Array.isArray(session.groups)
            || !Array.isArray(session.tabs) || !session.tabs.length || (total += session.tabs.length) > 50000
            || !string(session.createdAt, 40) || !Number.isFinite(Date.parse(session.createdAt))) {
            throw new Error('备份中的收纳记录无效，未导入任何内容。');
        }
        const ids = new Set();
        const groups = session.groups.map(group => {
            if (!group || !string(group.id, 100) || ids.has(group.id) || !string(group.title, 32768)
                || !COLORS.includes(group.color) || typeof group.collapsed !== 'boolean') {
                throw new Error('备份中的分组信息无效。');
            }
            ids.add(group.id);
            return {id: group.id, title: group.title, color: group.color, collapsed: group.collapsed};
        });
        const tabs = session.tabs.map(tab => {
            if (!tab || !safeUrl(tab.url) || !string(tab.title, 32768) || typeof tab.pinned !== 'boolean'
                || (tab.groupId !== null && !ids.has(tab.groupId)) || (tab.pinned && tab.groupId !== null)) {
                throw new Error('备份含无效链接或分组引用，未导入任何内容。');
            }
            return {url: tab.url, title: tab.title, pinned: tab.pinned, groupId: tab.groupId};
        });
        return {id: crypto.randomUUID(), name: session.name, createdAt: session.createdAt, groups, tabs};
    });
}

/** @brief 将 OneTab 的空行分组、URL | 标题文本转换为可恢复记录。 */
export function parseImport(text, report = {}) {
    report.skipped = 0;
    if (typeof text !== 'string' || new TextEncoder().encode(text).length > 15 * 1024 * 1024) {
        throw new Error('导入文件不能超过 15 MB。');
    }
    const clean = text.replace(/^\uFEFF/, '').trim();
    if (clean.startsWith('{') || clean.startsWith('[')) {
        report.format = 'json';
        return validateBackup(JSON.parse(clean));
    }
    if (!clean) {
        throw new Error('文件没有可导入的标签。');
    }
    report.format = 'text';
    const sessions = clean.split(/\r?\n\s*\r?\n/).map((block, index) => {
        const groupId = `import-${index + 1}`;
        const tabs = block.split(/\r?\n/).filter(line => line.trim()).map(line => {
            const separator = line.indexOf(' | ');
            const url = (separator < 0 ? line : line.slice(0, separator)).trim();
            if (/^(edge|chrome|about|edge-extension|chrome-extension|devtools):/i.test(url)) {
                report.skipped++;
                return null;
            }
            return {url, title: separator < 0 ? url : line.slice(separator + 3).trim(),
                pinned: false, groupId};
        }).filter(Boolean);
        return {name: `OneTab 导入 ${index + 1}`, createdAt: new Date().toISOString(),
            groups: [{id: groupId, title: `导入分组 ${index + 1}`, color: COLORS[(index % 8) + 1], collapsed: false}],
            tabs};
    }).filter(session => session.tabs.length);
    if (!sessions.length) {
        throw new Error(`没有可导入的网页，已跳过 ${report.skipped} 个浏览器内部页。`);
    }
    return validateBackup({format: 'tabnest', version: 1, sessions});
}

/** @brief 重导文本时补回已有未分组链接的分组，不移动已有命名分组或固定标签。 */
export function regroupImported(existing, incoming) {
    const saved = new Map();
    for (const session of existing) {
        for (const tab of session.tabs) {
            const key = new URL(tab.url).href;
            if (!saved.has(key) || tab.groupId !== null || tab.pinned) {
                saved.set(key, tab);
            }
        }
    }
    const moved = new Set();
    const repaired = incoming.map(session => ({...session, tabs: session.tabs.map(tab => {
        const key = new URL(tab.url).href;
        const old = saved.get(key);
        if (old && old.groupId === null && !old.pinned && tab.groupId !== null) {
            moved.add(key);
            return {...tab, title: old.title};
        }
        return tab;
    })}));
    const remaining = existing.map(session => ({...session, tabs: session.tabs.filter(tab =>
        tab.groupId !== null || tab.pinned || !moved.has(new URL(tab.url).href))}))
        .filter(session => session.tabs.length);
    return {existing: remaining, incoming: repaired, regrouped: moved.size};
}

/** @brief JSON 保留全部元数据，文本以空行分组便于 OneTab 使用。 */
export function exportBackup(sessions, format = 'json') {
    if (format === 'txt') {
        return sessions.flatMap(session => {
            const keys = [...new Set(session.tabs.map(tab => tab.groupId))];
            return keys.map(key => session.tabs.filter(tab => tab.groupId === key)
                .map(tab => `${tab.url} | ${tab.title.replace(/[\r\n]+/g, ' ')}`).join('\n'));
        }).join('\n\n');
    }
    return JSON.stringify({format: 'tabnest', version: 1, exportedAt: new Date().toISOString(), sessions}, null, 4);
}

/** @brief 同名非空分组归入最新记录，保留重复链接、组内顺序和未分组标签。 */
export function mergeNamedGroups(sessions) {
    const result = structuredClone(sessions);
    const owners = new Map();
    for (const session of result) {
        const moved = new Set();
        for (const group of session.groups) {
            const name = group.title.trim();
            if (!name) {
                continue;
            }
            const owner = owners.get(name);
            if (!owner) {
                owners.set(name, {session, group});
                continue;
            }
            const tabs = session.tabs.filter(tab => tab.groupId === group.id);
            // 先移除原组，再插入目标组末尾，兼容同一记录内的同名分组。
            session.tabs = session.tabs.filter(tab => tab.groupId !== group.id);
            const targetTabs = owner.session.tabs;
            const index = targetTabs.findLastIndex(tab => tab.groupId === owner.group.id) + 1;
            targetTabs.splice(index, 0, ...tabs.map(tab => ({...tab, groupId: owner.group.id})));
            moved.add(group.id);
        }
        session.groups = session.groups.filter(group => !moved.has(group.id));
    }
    return result.filter(session => session.tabs.length);
}

/** @brief 按完整网址去重，保留首次出现的标签及其分组，查询参数和锚点不合并。 */
export function deduplicate(sessions, seen = new Set()) {
    let removed = 0;
    const cleaned = sessions.map(session => {
        const tabs = session.tabs.filter(tab => {
            const key = new URL(tab.url).href;
            if (seen.has(key)) {
                removed++;
                return false;
            }
            seen.add(key);
            return true;
        });
        const groups = session.groups.filter(group => tabs.some(tab => tab.groupId === group.id));
        return {...session, tabs, groups};
    }).filter(session => session.tabs.length);
    return {sessions: cleaned, removed};
}
