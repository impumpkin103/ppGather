document.addEventListener('DOMContentLoaded', () => {
    const taskTableBody = document.querySelector('#task-table tbody');
    const toolbarButtons = document.querySelectorAll('.toolbar button');
    const sidebarLinks = document.querySelectorAll('.sidebar a');
    const contextMenu = document.getElementById('context-menu');
    
    // --- 状态变量 ---
    let currentFilter = 'all';
    let tasksCache = [];
    let shiftKeyIsDown = false;
    let ctrlKeyIsDown = false;
    let lastClickedRow = null;
    
    // 鼠标选择相关的状态
    let isMouseDown = false;
    let selectionStartIndex = -1;

    // --- 键盘事件监听器 ---
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Shift') {
            shiftKeyIsDown = true;
        } else if (e.key === 'Control' || e.metaKey) {
            ctrlKeyIsDown = true;
        }

        if (ctrlKeyIsDown && e.key.toLowerCase() === 'a') {
            e.preventDefault();
            selectAllTasks();
        }
    });

    document.addEventListener('keyup', (e) => {
        if (e.key === 'Shift') {
            shiftKeyIsDown = false;
        } else if (e.key === 'Control' || e.metaKey) {
            ctrlKeyIsDown = false;
        }
    });
    
    // --- 辅助函数 ---
    function formatBytes(bytes, decimals = 2) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }

    function translateStatus(status, error = '') {
        switch (status) {
            case 'queued':
                return chrome.i18n.getMessage('js_statusQueued');
            case 'in_progress':
                return chrome.i18n.getMessage('js_statusInProgress');
            case 'complete':
                return chrome.i18n.getMessage('js_statusComplete');
            case 'error':
                return chrome.i18n.getMessage('js_statusError', [error]);
            case 'retrying':
                return chrome.i18n.getMessage('js_statusRetrying');
            case 'paused':
                return chrome.i18n.getMessage('js_statusPaused');
            default:
                return chrome.i18n.getMessage('js_statusUnknown');
        }
    }

    // --- 渲染函数 ---
    function renderTasks(tasks) {
        // 在清空表格前，获取所有选中的任务 ID
        const selectedTaskIds = new Set(getSelectedTaskIds());

        taskTableBody.innerHTML = '';
        if (!tasks || tasks.length === 0) {
            taskTableBody.innerHTML = `<tr><td colspan="5" style="text-align:center;">${chrome.i18n.getMessage('js_noTasks')}</td></tr>`;
            return;
        }

        const filteredTasks = tasks.filter(task => {
            if (currentFilter === 'all') return true;
            if (currentFilter === 'downloading') return ['in_progress', 'queued', 'retrying'].includes(task.status);
            if (currentFilter === 'error') return task.status === 'error';
            if (currentFilter === 'complete') return task.status === 'complete';
            return true;
        });

        filteredTasks.sort((a, b) => (b.startTime || 0) - (a.startTime || 0));

        filteredTasks.forEach(task => {
            const row = document.createElement('tr');
            row.dataset.taskId = task.id;
            row.dataset.status = task.status;
            
            // 新增：如果该任务之前被选中，则重新添加 'selected' 类
            if (selectedTaskIds.has(task.id)) {
                row.classList.add('selected');
            }

            const filenameTd = document.createElement('td');
            filenameTd.textContent = task.filename;
            filenameTd.title = task.url;

            const sizeTd = document.createElement('td');
            sizeTd.textContent = task.totalBytes ? formatBytes(task.totalBytes) : 'N/A';
            
            const progressTd = document.createElement('td');
            const progress = task.totalBytes > 0 ? (task.bytesReceived / task.totalBytes) * 100 : 0;
            progressTd.innerHTML = `
                <div style="position: relative; height: 20px; background-color: #eee; border-radius: 4px; overflow: hidden;">
                    <div class="progress-bar" style="width: ${progress.toFixed(2)}%; height: 100%; background-color: #007bff;"></div>
                    <span class="progress-text" style="position: absolute; width: 100%; text-align: center; top: 0; left: 0; color: #333; font-size: 12px; line-height: 20px;">
                        ${progress.toFixed(1)}%
                    </span>
                </div>`;

            const speedTd = document.createElement('td');
            speedTd.textContent = task.status === 'in_progress' ? `${formatBytes(task.speed)}/s` : ' - ';

            const statusTd = document.createElement('td');
            statusTd.textContent = translateStatus(task.status, task.error);
            statusTd.className = `status-${task.status}`;
            
            row.append(filenameTd, sizeTd, progressTd, speedTd, statusTd);
            taskTableBody.appendChild(row);
        });
    }

    // --- 事件处理函数 ---
    function getSelectedTaskIds() {
        const selectedIds = [];
        document.querySelectorAll('tr.selected').forEach(row => {
            selectedIds.push(row.dataset.taskId);
        });
        return selectedIds;
    }
    
    function handleTaskControl(action, taskIds) {
        if (taskIds.length === 0) {
            alert(chrome.i18n.getMessage('js_selectAtLeastOne'));
            return;
        }

        backgroundAction = action;

        if (backgroundAction) {
            chrome.runtime.sendMessage({ action: backgroundAction, taskIds: taskIds });
        }
        
        contextMenu.style.display = 'none';
    }
    
    // --- 核心：鼠标拖选和点击多选逻辑 ---
    taskTableBody.addEventListener('mousedown', (e) => {
        // 忽略右键，确保右键菜单可以正常弹出
        if (e.button === 2) {
            isMouseDown = false;
            selectionStartIndex = -1;
            // 如果右键点击的行没有被选中，则只选中它
            const row = e.target.closest('tr');
            if (row && !row.classList.contains('selected')) {
                document.querySelectorAll('tr.selected').forEach(r => r.classList.remove('selected'));
                row.classList.add('selected');
            }
            return; 
        }
        
        isMouseDown = true;
        const row = e.target.closest('tr');
        if (!row) {
            document.querySelectorAll('tr.selected').forEach(r => r.classList.remove('selected'));
            return;
        }

        const allRows = Array.from(taskTableBody.querySelectorAll('tr'));
        const clickedIndex = allRows.indexOf(row);
        
        // 仅在左键点击时阻止默认行为
        e.preventDefault();

        if (shiftKeyIsDown && lastClickedRow) {
            const lastIndex = allRows.indexOf(lastClickedRow);
            const start = Math.min(lastIndex, clickedIndex);
            const end = Math.max(lastIndex, clickedIndex);

            allRows.forEach((r, i) => {
                if (i >= start && i <= end) {
                    r.classList.add('selected');
                } else {
                    r.classList.remove('selected');
                }
            });
        } else if (ctrlKeyIsDown) {
            row.classList.toggle('selected');
            lastClickedRow = row;
        } else {
            document.querySelectorAll('tr.selected').forEach(r => r.classList.remove('selected'));
            row.classList.add('selected');
            lastClickedRow = row;
        }

        selectionStartIndex = clickedIndex;
    });

    taskTableBody.addEventListener('mouseover', (e) => {
        if (!isMouseDown || selectionStartIndex === -1) return;
        
        const endRow = e.target.closest('tr');
        if (!endRow) return;

        const allRows = Array.from(taskTableBody.querySelectorAll('tr'));
        const endIndex = allRows.indexOf(endRow);

        const start = Math.min(selectionStartIndex, endIndex);
        const end = Math.max(selectionStartIndex, endIndex);

        allRows.forEach((r, i) => {
            if (i >= start && i <= end) {
                r.classList.add('selected');
            } else {
                r.classList.remove('selected');
            }
        });
    });

    document.addEventListener('mouseup', () => {
        isMouseDown = false;
        selectionStartIndex = -1;
    });

   // 右键菜单处理
    taskTableBody.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const row = e.target.closest('tr');
        if (!row) return;

        if (!row.classList.contains('selected')) {
            document.querySelectorAll('tr.selected').forEach(r => r.classList.remove('selected'));
            row.classList.add('selected');
        }

        const menuX = e.pageX;
        const menuY = e.pageY;

        // 确保菜单不会超出屏幕边界
        const menuWidth = contextMenu.offsetWidth;
        const menuHeight = contextMenu.offsetHeight;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        
        let finalX = menuX;
        let finalY = menuY;

        if (menuX + menuWidth > viewportWidth) {
            finalX = viewportWidth - menuWidth;
        }

        if (menuY + menuHeight > viewportHeight) {
            finalY = viewportHeight - menuHeight;
        }

        contextMenu.style.display = 'block';
        contextMenu.style.left = `${finalX}px`;
        contextMenu.style.top = `${finalY}px`;
    });

    document.addEventListener('click', () => {
        contextMenu.style.display = 'none';
    });

    contextMenu.addEventListener('click', (e) => {
        const action = e.target.dataset.action;
        if (action === 'select-all') {
            document.querySelectorAll('#task-table tr').forEach(row => row.classList.add('selected'));
        } else if (action === 'deselect-all') {
            document.querySelectorAll('tr.selected').forEach(row => row.classList.remove('selected'));
        } else if (action) {
            handleTaskControl(action, getSelectedTaskIds());
        }
    });

    // 顶部按钮事件
    document.getElementById('start-selected').addEventListener('click', () => {
        handleTaskControl('startTasks', getSelectedTaskIds());
    });
    document.getElementById('pause-selected').addEventListener('click', () => {
        handleTaskControl('pauseTasks', getSelectedTaskIds());
    });
    document.getElementById('delete-selected').addEventListener('click', () => {
        handleTaskControl('deleteTasks', getSelectedTaskIds());
    });

    document.getElementById('start-all-tasks').addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'startAllTasks' });
    });
    document.getElementById('pause-all-tasks').addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'pauseAllTasks' });
    });

    document.getElementById('clear-all-complete').addEventListener('click', () => {
        if (confirm(chrome.i18n.getMessage('js_confirmClearComplete'))) {
            chrome.runtime.sendMessage({ action: 'clearCompleteTasks' });
        }
    });

    document.getElementById('clear-all-tasks').addEventListener('click', () => {
        if (confirm(chrome.i18n.getMessage('js_confirmClearAll'))) {
            chrome.runtime.sendMessage({ action: 'clearAllTasks' });
        }
    });

    document.getElementById('clear-error-tasks').addEventListener('click', () => {
        if (confirm(chrome.i18n.getMessage('js_confirmClearError'))) {
            chrome.runtime.sendMessage({ action: 'clearErrorTasks' });
        }
    });

    // 打开下载目录
    document.getElementById('open-download-folder').addEventListener('click', () => {
        chrome.downloads.showDefaultFolder();
    });

    // 任务分类过滤
    sidebarLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            sidebarLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            currentFilter = link.id.replace('filter-', '');
            renderTasks(tasksCache);
            lastClickedRow = null;
        });
    });

    // --- 初始加载和监听 ---
    function loadTasks() {
        chrome.storage.local.get({ DownloadTasks: [] }, (result) => {
            tasksCache = result.DownloadTasks;
            renderTasks(tasksCache);
        });
    }
    
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local' && changes.DownloadTasks) {
            tasksCache = changes.DownloadTasks.newValue;
            renderTasks(tasksCache);
            
            // 重新设置 lastClickedRow，以支持 Shift 多选
            const selectedRows = document.querySelectorAll('tr.selected');
            if (selectedRows.length > 0) {
                lastClickedRow = selectedRows[selectedRows.length - 1];
            } else {
                lastClickedRow = null;
            }
        }
    });
    
    loadTasks();
});