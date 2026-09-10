/** @file 以打开弹窗时的真实窗口为范围，提供可见目标选择并通过后台安全收纳。 */
import {safeUrl} from './model.mjs';

const $ = selector => document.querySelector(selector);
let windowId;
let busy = true;
let count = 0;
let revision = 0;

function status(text, error = false) {
    $('#status').textContent = text;
    $('#status').classList.toggle('error', error);
}

function enable() {
    $('#capture-tab').disabled = busy || !$('#tab-choice').value;
    $('#capture-group').disabled = busy || !$('#group-choice').value;
    $('#capture-window').disabled = busy || !count;
    $('#open-manager').disabled = busy;
    document.querySelectorAll('select, input').forEach(element => { element.disabled = busy; });
}

function option(value, text) {
    const item = document.createElement('option');
    item.value = value;
    item.textContent = text;
    return item;
}

async function loadTargets(initial = false) {
    const currentRevision = ++revision;
    const [tabs, groups] = await Promise.all([
        chrome.tabs.query({windowId}), chrome.tabGroups.query({windowId})
    ]);
    if (currentRevision !== revision) {
        return;
    }
    const active = tabs.find(tab => tab.active);
    const tabId = initial ? String(active?.id) : $('#tab-choice').value;
    const groupId = initial ? String(active?.groupId) : $('#group-choice').value;
    const usable = tabs.filter(tab => !tab.incognito && safeUrl(tab.pendingUrl || tab.url));
    count = usable.length;
    $('#tab-choice').replaceChildren(option('', '请选择一个已打开的标签'), ...usable.map(tab =>
        option(String(tab.id), `${tab.active ? '当前 · ' : ''}${tab.title || tab.pendingUrl || tab.url}`)));
    $('#tab-choice').value = usable.some(tab => String(tab.id) === tabId) ? tabId : '';
    const available = groups.filter(group => usable.some(tab => tab.groupId === group.id));
    $('#group-choice').replaceChildren(option('', available.length ? '请选择浏览器分组' : '此窗口暂无分组'),
        ...available.map(group => option(String(group.id),
            `${group.title || '未命名分组'} · ${usable.filter(tab => tab.groupId === group.id).length} 个标签`)));
    $('#group-choice').value = available.some(group => String(group.id) === groupId) ? groupId : '';
    $('#window-count').textContent = `${count} 个标签 · 当前窗口`;
    enable();
}

async function send(message) {
    const result = await chrome.runtime.sendMessage(message);
    if (!result?.ok) {
        throw new Error(result?.error || '扩展连接中断，请重新打开弹窗。');
    }
    return result.data;
}

async function capture(scope) {
    if (busy) {
        return;
    }
    busy = true;
    enable();
    try {
        status('正在保存…');
        const mergeGroups = $('#merge-groups').checked;
        await chrome.storage.local.set({mergeGroups});
        const result = await send({type: 'capture', scope, windowId,
            tabId: Number($('#tab-choice').value), groupId: Number($('#group-choice').value),
            closeTabs: $('#close-tabs').checked, mergeGroups, openManager: true});
        const summary = result.count ? `新增 ${result.count} 个标签。` : '已经收纳，没有重复添加。';
        status(`${summary}跳过 ${result.duplicates} 个重复网址。${result.unclosed ? '部分原标签未关闭。' : ''}`);
        await loadTargets();
    } catch (error) {
        status(error.message, true);
    } finally {
        busy = false;
        enable();
    }
}

for (const scope of ['tab', 'group', 'window']) {
    $(`#capture-${scope}`).addEventListener('click', () => capture(scope));
}
$('#tab-choice').addEventListener('change', enable);
$('#group-choice').addEventListener('change', enable);
$('#open-manager').addEventListener('click', async () => {
    try {
        await send({type: 'open-manager', windowId});
    } catch (error) {
        status(error.message, true);
    }
});

// 关闭或移动目标时刷新选项，保留用户显式选择，不改收纳范围。
function refreshTargets() {
    if (windowId !== undefined && !busy) {
        loadTargets().catch(error => status(error.message, true));
    }
}
chrome.tabs.onRemoved.addListener(refreshTargets);
chrome.tabs.onUpdated.addListener(refreshTargets);
chrome.tabs.onCreated.addListener(refreshTargets);
chrome.tabs.onAttached.addListener(refreshTargets);
chrome.tabs.onDetached.addListener(refreshTargets);
chrome.tabGroups.onUpdated.addListener(refreshTargets);

try {
    const [window, settings] = await Promise.all([
        chrome.windows.getCurrent(), chrome.storage.local.get(['dark', 'mergeGroups'])
    ]);
    windowId = window.id;
    document.documentElement.dataset.theme = settings.dark ? 'dark' : 'light';
    $('#merge-groups').checked = settings.mergeGroups !== false;
    await loadTargets(true);
    status('默认仅保存；全部收纳指当前窗口，内部页面自动跳过。');
} catch (error) {
    status(error.message, true);
} finally {
    busy = false;
    enable();
}
