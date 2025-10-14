// content.js

// 全局变量，防止重复创建模态窗口
if (!window.ppp_modalExists) 
    window.ppp_modalExists = false;

// 移除模态窗口的函数
function removeModal() {
    const backdrop = document.getElementById('bulk-downloader-backdrop');
    const modal = document.getElementById('bulk-downloader-modal');
    if (backdrop) document.body.removeChild(backdrop);
    if (modal) document.body.removeChild(modal);
    window.ppp_modalExists = false;
}

// 创建并显示模态窗口
function showModalWithContent(items) {
    if (window.ppp_modalExists) return;
    if (!items || items.length === 0) {
        alert(chrome.i18n.getMessage('filter_noContent'));
        return;
    }
    window.ppp_modalExists = true;

    // 1. 注入CSS样式
    const styleLink = document.createElement('link');
    styleLink.rel = 'stylesheet';
    styleLink.type = 'text/css';
    styleLink.href = chrome.runtime.getURL('modal.css');
    document.head.appendChild(styleLink);

    // 2. 创建背景遮罩
    const backdrop = document.createElement('div');
    backdrop.id = 'bulk-downloader-backdrop';
    backdrop.onclick = removeModal;
    document.body.appendChild(backdrop);

    // 3. 创建模态窗口容器
    const modal = document.createElement('div');
    modal.id = 'bulk-downloader-modal';

    // 4. 创建iframe来加载 filter.html
    const iframe = document.createElement('iframe');
    iframe.src = chrome.runtime.getURL('filter.html');
    
    // 5. 使用 postMessage 将数据传递给 iframe
    iframe.onload = () => {
        iframe.contentWindow.postMessage({
            type: 'INIT_ITEMS',
            items: items
        }, '*');
    };

    modal.appendChild(iframe);
    document.body.appendChild(modal);
}

// 监听来自 filter.js (iframe内部) 的消息，以下载或关闭
window.addEventListener('message', (event) => {
    if (event.data.action === 'downloadLinks') {
        chrome.runtime.sendMessage(event.data);
        removeModal();
    } else if (event.data.action === 'closeModal') {
        removeModal();
    }
});


// --- 链接和文本提取逻辑 ---
function processContentNodes(nodes) {
    const content = new Set();
    const formattedContent = [];
    nodes.forEach(node => {
        // 提取链接
        if (node.tagName === 'A' && node.href) {
            try {
                const absoluteUrl = new URL(node.href, document.baseURI).href;
                if (!content.has(absoluteUrl)) {
                    content.add(absoluteUrl);
                    const urlObj = new URL(absoluteUrl);
                    let filename = urlObj.pathname.split('/').pop() || (urlObj.hostname.replace(/\./g, '_') + '.html');
                    formattedContent.push({
                        type: 'link',
                        value: absoluteUrl,
                        filename: decodeURIComponent(filename)
                    });
                }
            } catch (e) {
                console.warn('发现无效链接:', node.href);
            }
        } else {
            // 提取文本，并进行一些基本的清理
            const text = node.textContent.trim();
            if (text && !content.has(text) && text.length > 5) {
                 content.add(text);
                 formattedContent.push({
                    type: 'text',
                    value: text,
                    filename: null
                 });
            }
        }
    });
    return formattedContent;
}

// 提取整个页面的内容
function getContentFromEntirePage() {
    return processContentNodes(document.querySelectorAll('a, p, h1, h2, h3, h4, h5, h6, li'));
}

// 提取选定区域的内容
function getContentFromSelection() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return [];
    
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < selection.rangeCount; i++) {
        fragment.appendChild(selection.getRangeAt(i).cloneContents());
    }

    // 检查是否有链接，如果没有，则获取纯文本
    const hasLinks = fragment.querySelectorAll('a').length > 0;
    let nodesToProcess = [];
    if (hasLinks) {
        nodesToProcess = fragment.querySelectorAll('a, p, h1, h2, h3, h4, h5, h6, li');
    } else {
        // 如果没有链接，直接处理选定的纯文本
        nodesToProcess = [document.createElement('div')];
        nodesToProcess[0].textContent = selection.toString().trim();
    }

    return processContentNodes(nodesToProcess);
}


// 监听后台指令来启动提取流程
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    let extractedContent = [];
    if (message.action === "extractFromPage") {
        extractedContent = getContentFromEntirePage();
    } else if (message.action === "extractFromSelection") {
        extractedContent = getContentFromSelection();
    }
    showModalWithContent(extractedContent);
});