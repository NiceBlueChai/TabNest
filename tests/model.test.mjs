/** @file 使用 Node 内建测试验证导入安全、数据往返和跨记录同名分组合并。 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {snapshot, safeUrl, parseImport, exportBackup, mergeNamedGroups, deduplicate,
    regroupImported} from '../model.mjs';

const make = (name, id, title, url) => ({
    id: crypto.randomUUID(), name, createdAt: new Date().toISOString(),
    groups: [{id, title, color: 'green', collapsed: false}],
    tabs: [{title: name, url, pinned: false, groupId: id}]
});

test('JSON round trip preserves groups, order, pinned state and dates', () => {
    const source = make('研究', '1', '工作', 'https://example.com');
    source.tabs.unshift({title: '固定', url: 'https://example.org', pinned: true, groupId: null});
    const [parsed] = parseImport(exportBackup([source]));
    assert.notEqual(parsed.id, source.id);
    assert.deepEqual({...parsed, id: source.id}, source);
});

test('OneTab import preserves blank-line groups and titles containing separators', () => {
    const sessions = parseImport('\uFEFFhttps://example.com | 标题 | 子标题\r\n\r\nhttps://example.org');
    assert.equal(sessions.length, 2);
    assert.equal(sessions[0].tabs[0].title, '标题 | 子标题');
    assert.equal(sessions[0].groups[0].title, '导入分组 1');
    assert.equal(sessions[1].groups[0].title, '导入分组 2');
    assert.equal(sessions[0].tabs[0].groupId, sessions[0].groups[0].id);
    assert.equal(parseImport(exportBackup(sessions, 'txt')).length, 2);
});

test('unsafe and malformed imports fail atomically', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,x', 'not a url']) {
        assert.equal(safeUrl(url), false);
        assert.throws(() => parseImport(`https://example.com\n${url}`));
    }
    assert.throws(() => parseImport(''));
    assert.throws(() => parseImport('{broken'));
    const source = make('研究', '1', '工作', 'https://example.com');
    source.tabs[0].groupId = 'missing';
    assert.throws(() => parseImport(exportBackup([source])));
});

test('internal pages are skipped without discarding valid text groups', () => {
    const report = {};
    const sessions = parseImport('https://a.example | A\nedge://extensions | 扩展\n\n'
        + 'about:blank\n\nhttps://b.example | B', report);
    assert.equal(report.skipped, 2);
    assert.equal(sessions.length, 2);
    assert.equal(sessions[1].groups[0].title, '导入分组 3');
    assert.throws(() => parseImport('edge://extensions'), /没有可导入/);
    const json = make('测试', '1', '分组', 'edge://extensions');
    assert.throws(() => parseImport(exportBackup([json])));
});

test('reimport regroups existing loose links without duplicates or moving organized tabs', () => {
    const existing = make('旧记录', '1', '保留我的分组', 'https://a.example');
    existing.tabs.push({title: '用户保留标题', url: 'https://b.example', pinned: false, groupId: null});
    existing.tabs.push({title: '固定', url: 'https://c.example', pinned: true, groupId: null});
    const original = structuredClone(existing);
    const incoming = parseImport('https://a.example | A\nhttps://b.example | B\nhttps://c.example | C');
    const result = regroupImported([existing], incoming);
    assert.equal(result.regrouped, 1);
    assert.equal(result.existing[0].tabs.length, 2);
    assert.equal(result.incoming[0].tabs[1].title, '用户保留标题');
    assert.deepEqual(existing, original);
    const seen = new Set(result.existing.flatMap(session => session.tabs.map(tab => new URL(tab.url).href)));
    const unique = deduplicate(result.incoming, seen);
    assert.equal(unique.sessions[0].tabs.length, 1);
    assert.equal(unique.sessions[0].tabs[0].groupId, unique.sessions[0].groups[0].id);
    const combined = [...unique.sessions, ...result.existing];
    assert.equal(regroupImported(combined, incoming).regrouped, 0);
});

test('snapshot preserves browser order and excludes internal pages', () => {
    const result = snapshot([
        {index: 2, url: 'https://b.example', groupId: 8, title: 'B'},
        {index: 0, url: 'edge://newtab', groupId: -1},
        {index: 1, url: 'https://a.example', groupId: -1, pinned: true}
    ], [{id: 8, title: '开发', color: 'purple', collapsed: true}], '窗口');
    assert.deepEqual(result.tabs.map(tab => tab.url), ['https://a.example', 'https://b.example']);
    assert.equal(result.groups[0].collapsed, true);
    assert.equal(result.tabs[0].pinned, true);
});

test('same-name merge preserves every tab and keeps unrelated data', () => {
    const newest = make('新', '3', ' 工作 ', 'https://new.example');
    const old = make('旧', '1', '工作', 'https://old.example');
    old.tabs.push({title: '其他', url: 'https://other.example', groupId: null, pinned: true});
    const original = structuredClone([newest, old]);
    const merged = mergeNamedGroups([newest, old]);
    assert.deepEqual([newest, old], original);
    assert.equal(merged.length, 2);
    assert.deepEqual(merged[0].tabs.map(tab => tab.url), ['https://new.example', 'https://old.example']);
    assert.equal(merged[1].tabs.length, 1);
    assert.equal(merged[1].tabs[0].pinned, true);
    assert.equal(merged[1].groups.length, 0);
    assert.doesNotThrow(() => parseImport(exportBackup(merged)));
});

test('same-record duplicates merge; unnamed and different-case groups stay separate', () => {
    const session = make('新', '1', 'Work', 'https://one.example');
    for (const [id, title] of [['2', 'Work'], ['3', ''], ['4', 'work']]) {
        session.groups.push({id, title, color: 'blue', collapsed: false});
        session.tabs.push({title: id, url: 'https://two.example', pinned: false, groupId: id});
    }
    const [merged] = mergeNamedGroups([session]);
    assert.equal(merged.groups.length, 3);
    assert.equal(merged.tabs.length, 4);
    assert.deepEqual(merged.tabs.map(tab => tab.groupId), ['1', '1', '3', '4']);
});

test('URL deduplication removes repeated records without mutating original data', () => {
    const first = make('新', '1', '工作', 'https://example.com/');
    const second = make('旧', '2', '其他', 'https://example.com');
    second.tabs.push({title: '不同参数', url: 'https://example.com/?a=1', pinned: true, groupId: null});
    second.tabs.push({title: '不同锚点', url: 'https://example.com/#a', pinned: false, groupId: null});
    const original = structuredClone([first, second]);
    const cleaned = deduplicate([first, second]);
    assert.equal(cleaned.removed, 1);
    assert.equal(cleaned.sessions[1].groups.length, 0);
    assert.equal(cleaned.sessions[1].tabs.length, 2);
    assert.deepEqual([first, second], original);
    assert.deepEqual(deduplicate(cleaned.sessions).sessions, cleaned.sessions);
    assert.equal(deduplicate([first, first]).sessions.length, 1);
});

test('incoming repeated URLs are skipped even when groups or titles differ', () => {
    const seen = new Set(['https://example.com/']);
    const result = deduplicate([make('新标题', '9', '新分组', 'https://EXAMPLE.com:443/')], seen);
    assert.equal(result.removed, 1);
    assert.deepEqual(result.sessions, []);
});
