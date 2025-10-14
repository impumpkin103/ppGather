/**
 * 通用国际化脚本
 * 在 DOM 加载后，自动翻译页面中带有 data-i18n-* 属性的元素。
 */
document.addEventListener('DOMContentLoaded', () => {
    // 翻译元素的 textContent
    document.querySelectorAll('[data-i18n]').forEach(element => {
        element.textContent = chrome.i18n.getMessage(element.getAttribute('data-i18n'));
    });

    // 翻译元素的 placeholder 属性
    document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
        element.placeholder = chrome.i18n.getMessage(element.getAttribute('data-i18n-placeholder'));
    });

    // 翻译页面的 <title> 标签
    const titleTag = document.querySelector('title[data-i18n]');
    if (titleTag) {
        document.title = chrome.i18n.getMessage(titleTag.getAttribute('data-i18n'));
    }
});