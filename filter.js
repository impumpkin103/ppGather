// filter.js

document.addEventListener('DOMContentLoaded', () => {
    const linksContainer = document.getElementById('links-container');
    const selectAllBtn = document.getElementById('select-all');
    const deselectAllBtn = document.getElementById('deselect-all');
    const downloadBtn = document.getElementById('download-selected');
    const copyBtn = document.getElementById('copy-selected');
    const filterExtInput = document.getElementById('filter-ext');
    const filterRegexInput = document.getElementById('filter-keyword');
    const selectionInfo = document.getElementById('selection-info');
    const copyMessage = document.getElementById('copy-message');
    const filterTypeRadios = document.querySelectorAll('input[name="filter-type"]');
    const extHistoryList = document.getElementById('ext-history-list');
    const regexHistoryList = document.getElementById('regex-history-list');

    let allItems = [];
    let visibleItems = [];
    let filterTimer;
    let activeFilterInput = null; // 新增：追踪当前激活的输入框

    // 监听来自 content.js 的消息来接收数据
    window.addEventListener('message', (event) => {
        if (event.data.type === 'INIT_ITEMS') {
            allItems = event.data.items;
            visibleItems = [...allItems];
            restoreFilters();
        }
    });

    // 恢复上次保存的过滤条件
    function restoreFilters() {
        chrome.storage.sync.get({
            savedExtFilter: '',
            savedRegexFilter: '',
            savedActiveFilter: 'ext', // 新增：恢复上次激活的过滤器
            savedFilterType: 'link',
            extHistory: [],
            regexHistory: []
        }, (items) => {
            filterExtInput.value = items.savedExtFilter;
            filterRegexInput.value = items.savedRegexFilter;
            populateDatalist(extHistoryList, items.extHistory);
            populateDatalist(regexHistoryList, items.regexHistory);

            // 根据保存的激活状态恢复 activeFilterInput
            if (items.savedActiveFilter === 'regex') {
                activeFilterInput = filterRegexInput;
            } else if (items.savedExtFilter) {
                activeFilterInput = filterExtInput;
            }

            // 恢复单选框状态
            document.getElementById(`filter-${items.savedFilterType}`).checked = true;
            applyFilters();
        });
    }

    // 新增：填充 datalist 的函数
    function populateDatalist(datalistElement, historyArray) {
        datalistElement.innerHTML = '';
        historyArray.forEach(value => {
            const option = document.createElement('option');
            option.value = value;
            datalistElement.appendChild(option);
        });
    }

    function renderItems(items) {
        linksContainer.innerHTML = '';
        items.forEach((item, index) => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'link-item';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = `item-${index}`;
            checkbox.dataset.value = item.value;
            checkbox.dataset.filename = item.filename;
            checkbox.dataset.type = item.type;
            checkbox.checked = true;
            const label = document.createElement('label');
            label.htmlFor = `item-${index}`;
            label.textContent = item.value;
            itemDiv.appendChild(checkbox);
            itemDiv.appendChild(label);
            linksContainer.appendChild(itemDiv);
        });
        updateSelectionInfo();
    }

    // 应用过滤逻辑函数
 function applyFilters() {
    // 根据当前激活的输入框来确定过滤条件
    const isExtFilterActive = activeFilterInput === filterExtInput && filterExtInput.value.trim() !== '';
    const isRegexFilterActive = activeFilterInput === filterRegexInput && filterRegexInput.value.trim() !== '';

    const selectedFilterType = document.querySelector('input[name="filter-type"]:checked').value;
    // 只有当扩展名过滤器是当前激活的过滤器时才解析其值
    const extensions = isExtFilterActive ? filterExtInput.value.toLowerCase().split(',').map(e => e.trim()).filter(e => e) : [];
    // 只有当正则过滤器是当前激活的过滤器时才解析其值
    const regexString = isRegexFilterActive ? filterRegexInput.value.trim() : '';
    let regex = null;
    updateInputHighlight();
    
    // 根据内容类型禁用/启用扩展名输入框和下载按钮
    if (selectedFilterType === 'all') {
        filterExtInput.disabled = true;
        downloadBtn.disabled = true; // 禁用下载按钮
        downloadBtn.style.opacity = '0.5'; // 可选：添加视觉效果
    } else {
        filterExtInput.disabled = false;
        downloadBtn.disabled = false; // 启用下载按钮
        downloadBtn.style.opacity = '1';
    }
    
    try {
        if (regexString) {
            regex = new RegExp(regexString, 'i');
        }
    } catch (e) {
        console.error("无效的正则表达式:", e);
        renderItems([]);
        return;
    }

    visibleItems = allItems.filter(item => {
        // --- 修改此行，使其能正确处理 'link' 和 'text' 类型 ---
        const typeMatch = (selectedFilterType === 'all') || (item.type === selectedFilterType);

        // 如果内容类型是'text'，则不进行扩展名过滤
        if (item.type === 'text') {
            const regexMatch = !regex || regex.test(item.value);
            return typeMatch && regexMatch;
        }

        const valueLower = item.value.toLowerCase();
        const extMatch = selectedFilterType === 'all' || extensions.length === 0 || extensions.some(ext => valueLower.endsWith(`.${ext}`));
        const regexMatch = !regex || regex.test(item.value);

        return typeMatch && extMatch && regexMatch;
    });
    renderItems(visibleItems);
}

    
    // --- 修改：输入框事件监听器，增加互斥逻辑 ---
    function setupFilterListeners() {
        const handleFocus = (focusedInput) => {
            activeFilterInput = focusedInput;
            applyFilters(); // 切换焦点时立即应用过滤
        };

        const handleInput = () => {
            clearTimeout(filterTimer);
            filterTimer = setTimeout(applyFilters, 1000);
        };

        filterExtInput.addEventListener('focus', () => handleFocus(filterExtInput));
        filterRegexInput.addEventListener('focus', () => handleFocus(filterRegexInput));

        filterExtInput.addEventListener('input', handleInput);
        filterRegexInput.addEventListener('input', handleInput);
    }

    setupFilterListeners();

    // --- 新增：更新输入框高亮 ---
    function updateInputHighlight() {
        filterExtInput.classList.remove('active-filter');
        filterRegexInput.classList.remove('active-filter');

        if (activeFilterInput === filterExtInput && !filterExtInput.disabled) {
            filterExtInput.classList.add('active-filter');
        } else if (activeFilterInput === filterRegexInput) {
            filterRegexInput.classList.add('active-filter');
        }
    }

    // 监听内容类型切换
    filterTypeRadios.forEach(radio => {
        radio.addEventListener('change', () => {
            applyFilters();
        });
    });

    selectAllBtn.addEventListener('click', () => {
        linksContainer.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
        updateSelectionInfo();
    });

    deselectAllBtn.addEventListener('click', () => {
        linksContainer.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
        updateSelectionInfo();
    });

    // --- 新增函数：保存过滤配置 ---
    async function saveFilters() {
        const extValue = filterExtInput.value.trim();
        const regexValue = filterRegexInput.value.trim();
        const selectedFilterType = document.querySelector('input[name="filter-type"]:checked').value;
        
        // 新增：确定哪个过滤器是激活状态
        let savedActiveFilter = 'ext'; // 默认为 ext
        if (activeFilterInput === filterRegexInput) savedActiveFilter = 'regex';
        if (activeFilterInput === filterExtInput) savedActiveFilter = 'ext';

        try {
            const items = await chrome.storage.sync.get({ extHistory: [], regexHistory: [] });

            const updateHistory = (history, value) => {
                if (!value) return history; // 如果值为空，不更新历史记录
                // 将新值放在最前面，并移除旧的重复项
                const newHistory = [value, ...history.filter(item => item !== value)];
                return newHistory.slice(0, 10); // 保留最近10条
            };

            const newExtHistory = updateHistory(items.extHistory, extValue);
            const newRegexHistory = updateHistory(items.regexHistory, regexValue);

            await chrome.storage.sync.set({
                savedExtFilter: extValue,
                savedRegexFilter: regexValue,
                savedActiveFilter: savedActiveFilter, // 保存激活的过滤器
                savedFilterType: selectedFilterType,
                extHistory: newExtHistory,
                regexHistory: newRegexHistory
            });
            console.log('过滤条件和历史记录已保存。');
        } catch (error) {
            console.error('保存过滤条件失败:', error);
        }
    }

    downloadBtn.addEventListener('click', () => {
        // --- 调用保存配置的函数 ---
        saveFilters();

        const selectedLinks = [];
        linksContainer.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
            // 仅下载链接类型
            if (cb.dataset.type === 'link') {
                selectedLinks.push({ url: cb.dataset.value, filename: cb.dataset.filename });
            }
        });

        if (selectedLinks.length > 0) {
            window.parent.postMessage({
                action: 'downloadLinks',
                links: selectedLinks
            }, '*');
        } else {
            alert(chrome.i18n.getMessage('filter_selectToDownload'));
        }
    });

    // 新增：显示淡出消息的函数
    function showFadeOutMessage(messageText) {
        copyMessage.textContent = messageText;
        copyMessage.classList.add('show');
        setTimeout(() => {
            copyMessage.classList.remove('show');
        }, 2000);
    }

    // 新增：回退复制函数
    function fallbackCopyTextToClipboard(text) {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.top = "-9999px";
        textArea.style.left = "-9999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        
        try {
            const successful = document.execCommand('copy');
            if (successful) {
                showFadeOutMessage(chrome.i18n.getMessage('filter_copySuccess'));
            } else {
                alert(chrome.i18n.getMessage('filter_copyFail'));
            }
        } catch (err) {
            console.error('Fallback 复制失败:', err);
            alert(chrome.i18n.getMessage('filter_copyFail'));
        }
        
        document.body.removeChild(textArea);
    }

    copyBtn.addEventListener('click', async () => { // 将函数声明为 async
        // --- 调用保存配置的函数 ---
        saveFilters();
        
        const selectedCheckboxes = linksContainer.querySelectorAll('input[type="checkbox"]:checked');
        const selectedValues = Array.from(selectedCheckboxes).map(cb => cb.dataset.value);
        const textToCopy = selectedValues.join('\n');

        if (!textToCopy) {
            alert(chrome.i18n.getMessage('filter_selectToCopy'));
            return;
        }
        
        // 检查剪贴板API和权限，以完全避免在无权限时调用API导致控制台报告异常
        if (navigator.permissions && navigator.permissions.query) {
            try {
                const permissionStatus = await navigator.permissions.query({ name: 'clipboard-write' });
                if (permissionStatus.state === 'granted' || permissionStatus.state === 'prompt') {
                    // 有权限，尝试使用新API
                    await navigator.clipboard.writeText(textToCopy);
                    showFadeOutMessage(chrome.i18n.getMessage('filter_copySuccess'));
                } else {
                    // 权限被拒绝，直接使用回退方法
                    fallbackCopyTextToClipboard(textToCopy);
                }
            } catch (e) {
                // 如果权限查询失败或剪贴板API调用失败，都使用回退方法
                 fallbackCopyTextToClipboard(textToCopy);
            }
        } else {
            // 如果浏览器不支持权限查询API，但支持剪贴板API，仍按原逻辑尝试
            // 或者，如果连剪贴板API都不支持，也使用回退
            fallbackCopyTextToClipboard(textToCopy);
        }
    });
    
    linksContainer.addEventListener('change', (event) => {
        if (event.target.type === 'checkbox') {
            updateSelectionInfo();
        }
    });

    function updateSelectionInfo() {
        const total = linksContainer.querySelectorAll('.link-item').length;
        const selected = linksContainer.querySelectorAll('input[type="checkbox"]:checked').length;
        selectionInfo.textContent = chrome.i18n.getMessage('filter_selectionInfo', [selected, total]);
    }
});