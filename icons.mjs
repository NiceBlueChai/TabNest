/** @file 本地 SVG 线性图标，共用 24px 画布、圆角端点与统一描边，不依赖字体或网络。 */
const paths = {
    chevron: 'm6 9 6 6 6-6',
    edit: 'm15 5 4 4 M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15v5Z',
    trash: 'M4 6h16 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7',
    download: 'M12 3v12 m-4-4 4 4 4-4 M4 16v5h16v-5',
    upload: 'M12 16V4 m-4 4 4-4 4 4 M4 16v5h16v-5',
    external: 'M8 5h11v11 M19 5 5 19',
    archive: 'M4 8h16v13H4V8Z M3 3h18v5H3V3Z M9 12h6',
    search: 'M16 16l5 5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    close: 'm6 6 12 12 M18 6 6 18',
    grid: 'M3 3h7v7H3Z M14 3h7v7h-7Z M3 14h7v7H3Z M14 14h7v7h-7Z',
    moon: 'M20 15a8.5 8.5 0 0 1-11-11 9 9 0 1 0 11 11Z',
    sun: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M12 2v2 M12 20v2 M2 12h2 M20 12h2 '
        + 'M5 5l1.5 1.5 M17.5 17.5 19 19 M5 19l1.5-1.5 M17.5 6.5 19 5'
};

/** @brief 创建不参与可访问名称的装饰图标，由所在按钮提供文字标签。 */
export function icon(name, className = '') {
    if (!paths[name]) {
        throw new Error(`未知图标：${name}`);
    }
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [key, value] of Object.entries({viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
        'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
        'aria-hidden': 'true', focusable: 'false', class: `icon ${className}`})) {
        svg.setAttribute(key, value);
    }
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', paths[name]);
    svg.append(path);
    return svg;
}
