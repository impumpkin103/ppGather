
// 初始化
let activeDownloads = 0; 
let settings = { concurrency: 3, interval: 500, retries: 3 };
let downloadQueue = []; 

// 从storage加载设置
chrome.storage.sync.get(settings, (loadedSettings) => {
    settings = loadedSettings;
});

class TaskMng{
    _tasks = [];

    constructor(){
    }

    async LoadFromStorage(){
        chrome.storage.local.get({ DownloadTasks: [] }, (result) => {
            this._tasks = result.DownloadTasks;
            for (const task of this._tasks) {
                if (task.status !== 'complete'){
                    task.status = 'paused';
                    task.totalBytes = 0;
                    task.bytesReceived = 0;
                    task.speed = 0;
                    task.downloadId = null;
                    task.retriesLeft = settings.retries;
                }
            }
            chrome.storage.local.set({ DownloadTasks: this._tasks });
        });
    }

    async SaveToStorage(){
        await chrome.storage.local.set({ DownloadTasks: this._tasks });
    }

    get Tasks(){
        return this._tasks;
    }

    async update(Tasks) {
        if (!Array.isArray(Tasks)) {
            Tasks = [Tasks];
        }
        let hasChanges = false;
        for (const task of Tasks) {    
            const taskIndex = this._tasks.findIndex(t => t.id === task.id);
            if (taskIndex !== -1) {
                this._tasks[taskIndex] = { ...this._tasks[taskIndex], ...task };
                hasChanges = true;
            }
        }

        if (hasChanges)
            await this.SaveToStorage()
    }

    async add(Tasks) {
        if (!Array.isArray(Tasks)) {
            Tasks = [Tasks];
        }
        this._tasks = [...this._tasks, ...Tasks]
        await this.SaveToStorage();
    }

    async remove(Tasks) {
        if (!Array.isArray(Tasks)) {
            Tasks = [Tasks];
        }
        let hasChanges = false;
        for (const task of Tasks){
            const taskIndex = this._tasks.findIndex(t => t.id === task.id);
            if (taskIndex !== -1) {
                this._tasks.splice(taskIndex, 1);
                hasChanges = true;
            }
        }
        if (hasChanges)
            await this.SaveToStorage();
    }

    async clear() {
        this._tasks = [];
        await this.SaveToStorage();
    }
};

class TimerJob{
    _timer = null;
    _interval = 1000;
    _job = null;

    constructor(job, interval) {
        this._job = job;
        this._interval = interval;
    }

    start() {
        if (this._timer === null) {
            this._timer = setInterval(async () => {
                if (this._job && !this.isRunning) {
                    this.isRunning = true;
                    await this._job();
                    this.isRunning = false;
                }
            }, this._interval);
            console.log("TimerJob started")
        }
    }

    stop() {
        if (this._timer !== null) {
            console.log("TimerJob stopped")
            clearInterval(this._timer);
            this._timer = null;
        }
    }
}

let DownloadStatusTimeJob = new TimerJob(processDownloadStatusJob, 500);
let downloadTasks = new TaskMng();
downloadTasks.LoadFromStorage();

let downloadUiHideOwners = 0;

async function hideDownloadUi() {
    if (typeof chrome.downloads.setUiOptions !== 'function') {
        return;
    }

    try {
        await chrome.downloads.setUiOptions({ enabled: false });
    } catch (error) {
        console.warn('隐藏 Chrome 下载 UI 失败', error);
    }
}

async function showDownloadUi() {
    if (typeof chrome.downloads.setUiOptions !== 'function') {
        return;
    }

    try {
        await chrome.downloads.setUiOptions({ enabled: true });
    } catch (error) {
        console.warn('恢复 Chrome 下载 UI 失败', error);
    }
}

async function acquireDownloadUiHidden() {
    downloadUiHideOwners++;
    if (downloadUiHideOwners === 1) {
        await hideDownloadUi();
    }
}

async function releaseDownloadUiHidden() {
    if (downloadUiHideOwners <= 0) {
        downloadUiHideOwners = 0;
        return;
    }

    downloadUiHideOwners--;
    if (downloadUiHideOwners === 0) {
        await showDownloadUi();
    }
}

async function resetDownloadUiState() {
    downloadUiHideOwners = 0;
    await showDownloadUi();
}

void resetDownloadUiState();
// 初始化完

// 监听设置变化
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync') {
        for (let key in settings) {
            if (changes[key]) {
                settings[key] = changes[key].newValue;
            }
        }
    }
});

// 主循环，处理下载队列
function processQueue() {
    while (activeDownloads < settings.concurrency && downloadQueue.length > 0) {
        const task = downloadQueue.shift();
        if (task){
            activeDownloads++;
            if (task.downloadId)
                ResumeDownload(task);
            else
                startDownload(task);
        }
    }
}

// 开始一个下载任务
async function startDownload(task) {
    try {
        await acquireDownloadUiHidden();
        chrome.downloads.download({
            url: task.url,
            filename: task.filename,
            saveAs: false, // 禁用另存为弹窗
            conflictAction: 'uniquify' // 自动重命名同名文件            
        }, (downloadId) => {
            if (chrome.runtime.lastError) {
                void releaseDownloadUiHidden();
                handleDownloadError(task, chrome.runtime.lastError.message);
            } else {
                task.downloadId = downloadId;
                task.status = 'in_progress';
                task.retriesLeft = settings.retries;
                task.startTime = Date.now();
                downloadTasks.update(task);
                DownloadStatusTimeJob.start()
            }
        });
    } catch (error) {
        await releaseDownloadUiHidden();
        console.log(`下载失败: ${task.url}`, error);
        handleDownloadError(task, error.message);
    }
}

async function ResumeDownload(task) {
    try {
        chrome.downloads.resume(task.downloadId, function() {
            if (chrome.runtime.lastError) {
                handleDownloadError(task, chrome.runtime.lastError.message);
            } else {
                task.status = 'in_progress';
                task.startTime = Date.now();
                downloadTasks.update(task);
                DownloadStatusTimeJob.start()
            }
        });
        } catch (error) {
        handleDownloadError(task, error.message);
    }
}

function handleDownloadComplte(task){
    chrome.downloads.erase({id:task.downloadId})
    task.status = 'complete';
    task.downloadId = null
    task.speed = 0;
    void releaseDownloadUiHidden();
    activeDownloads--;
    processQueue();
}

function handleDownloadPaused(task){
    task.status = 'paused';
    task.speed = 0;
    void releaseDownloadUiHidden();
    activeDownloads--;
    processQueue();
}

function handleDownloadinterrupted(task, msg){
    chrome.downloads.erase({id:task.downloadId})
    task.status = 'error';
    task.error = msg;
    task.downloadId = null
    void releaseDownloadUiHidden();
    activeDownloads--;
    processQueue();
}

function handleDownloadError(task, errorMessage) {
    task.retriesLeft = (task.retriesLeft ?? settings.retries) - 1;
    if (task.retriesLeft >= 0) {
        task.status = 'retrying';
        downloadQueue.unshift(task);
    } else {
        task.status = 'error';
        task.error = errorMessage;
    }
    chrome.downloads.erase({id:task.downloadId})
    task.downloadId = null
    downloadTasks.update(task);
    void releaseDownloadUiHidden();
    activeDownloads--;
    processQueue();
}

async function processDownloadStatusJob() {
    const querys = downloadTasks.Tasks.filter(t => t.status === 'in_progress');
    if (querys.length === 0){
        DownloadStatusTimeJob.stop()
        return;
    }

    for (const task of querys){
        await chrome.downloads.search({ id: task.downloadId }, function(items) {
            if (items.length === 0) {
                handleDownloadError(task, 'unknown error');
            }
            else{
                const item = items[0];
                switch (item.state){
                    case 'in_progress':{
                        if (item.pause === true)
                            handleDownloadPaused(task);
                        else {
                            // 更新任务状态
                            let _speed =  (item.bytesReceived - task.bytesReceived) / ((Date.now() - task.startTime) / 1000);
                            task.speed = (task.speed + _speed) / 2
                            task.startTime = Date.now();
                            task.totalBytes = item.totalBytes;
                            task.bytesReceived = item.bytesReceived;
                            }
                        }
                        break;
                    case 'complete':
                        task.totalBytes = item.totalBytes;
                        task.bytesReceived = item.bytesReceived;
                        handleDownloadComplte(task);
                        break;
                    case 'interrupted':
                        task.status = 'error';
                        task.totalBytes = item.totalBytes;
                        task.bytesReceived = item.bytesReceived;
                        handleDownloadinterrupted(task, (item.error) ? item.error : 'unkown interrupted error')
                        break;
                    default:
                        console.error(item.error.message)
                }

                downloadTasks.update(task);
            }
        });
    }
}

// // 监听 downloads API 的状态变化
// chrome.downloads.onChanged.addListener(async (delta) => {
//     if (delta.state && (delta.state.current === 'in_progress' || delta.state.current === 'complete' || delta.state.current === 'interrupted')) {
//         const downloads = await chrome.downloads.search({ id: delta.id });
//         if (downloads && downloads.length > 0) {
//             const browserDownload = downloads[0];

//             //const { downloadTasks.Tasks = [] } = await chrome.storage.local.get('downloadTasks.Tasks');
//             const task = downloadTasks.Tasks.find(t => t.downloadId === browserDownload.id);

//             if (task) {
//                 if (delta.state.current === 'complete') {
//                     console.log('chrome.downloads.onChanged', delta.id, delta.state.current)
//                     //chrome.downloads.erase({id:task.downloadId})
//                     task.status = 'complete';
//                     task.downloadId = null
//                     task.speed = 0;
//                     activeDownloads--;
//                     processQueue();
//                 } else if (delta.state.current === 'interrupted') {
//                     task.status = 'error';
//                     task.error = browserDownload.error.message || '下载被中断';
//                     task.downloadId = null
//                     activeDownloads--;
//                     processQueue();
//                 }
//                 await downloadTasks.update(task);
//             }
//         }
//     }
// });

// 任务控制函数
async function startTasks(taskIds) {
    const tasksToResume = downloadTasks.Tasks.filter(t => taskIds.includes(t.id) && (t.status === 'paused' || t.status === 'error'));
    return _startTasks(tasksToResume);
}

async function _startTasks(tasks) {
    if (tasks.length > 0) {
        tasks.forEach(task => {
            task.status = 'queued';
            downloadQueue.unshift(task);
        });
        await downloadTasks.update(tasks);
        processQueue();
    }
}

// 新增：开始所有任务的函数
async function startAllTasks() {
    const tasksToStart = downloadTasks.Tasks.filter(t => ['paused', 'error', 'queued'].includes(t.status));

    await _startTasks(tasksToStart);
}

async function pauseTasks(taskIds) {
    downloadQueue = downloadQueue.filter(t => !taskIds.includes(t.id));
    
    for (const id of taskIds) {
        const task = downloadTasks.Tasks.find(t => t.id === id);
        if (task && task.downloadId) {
            chrome.downloads.pause(task.downloadId, () => {
                task.status = 'paused';
                downloadTasks.update(task);
                void releaseDownloadUiHidden();
                activeDownloads--;
            });
        }
    }

    const tasksInQueue = downloadTasks.Tasks.filter(t => taskIds.includes(t.id) && t.status === 'queued');
    tasksInQueue.forEach(task => {
        task.status = 'paused';
    });
    
    await downloadTasks.update(tasksInQueue);
}

async function pauseAllTasks() {
    //const { downloadTasks.Tasks = [] } = await chrome.storage.local.get('downloadTasks.Tasks');
    const tasksToPause = downloadTasks.Tasks.filter(t => t.status === 'in_progress' || t.status === 'retrying' || t.status === 'queued');
    await pauseTasks(tasksToPause.map(t => t.id));
}

async function deleteTasks(taskIds) {
    const deletingTasks = downloadTasks.Tasks.filter(t => taskIds.includes(t.id));
    downloadQueue = downloadQueue.filter(t => !taskIds.includes(t.id));
    
    for (const task of deletingTasks) {
        if (task && task.downloadId) {
            chrome.downloads.cancel(task.downloadId, () => {
                console.log(`已取消 chrome.downloads ID: ${task.downloadId}`);
                void releaseDownloadUiHidden();
            });
            activeDownloads--;
        }
    }

    await downloadTasks.remove(deletingTasks);
}

async function clearCompleteTasks() {
    //const { downloadTasks.Tasks = [] } = await chrome.storage.local.get('downloadTasks.Tasks');
    const completeTasks = downloadTasks.Tasks.filter(t => t.status === 'complete');
    await downloadTasks.remove(completeTasks);
}

async function clearAllTasks() {
    pauseAllTasks()
    const allTaskIds = downloadTasks.Tasks.map(t => t.id);
    await deleteTasks(allTaskIds);
    await downloadTasks.clear();
}

async function clearErrorTasks() {
    //const { downloadTasks.Tasks = [] } = await chrome.storage.local.get('downloadTasks.Tasks');
    const ErrorTasks = downloadTasks.Tasks.filter(t => t.status === 'error');
    await downloadTasks.remove(ErrorTasks);
}

// --- 监听器和入口点 ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'downloadLinks') {
        const existingUrls = new Set(downloadTasks.Tasks.map(task => task.url));
        const uniqueNewTasks = [];
        
        // 筛选出不重复的新任务
        for (const link of message.links) {
            if (!existingUrls.has(link.url)) {
                uniqueNewTasks.push({
                    id: self.crypto.randomUUID(), 
                    url: link.url,
                    filename: link.filename,
                    status: 'paused', 
                    totalBytes: 0,
                    bytesReceived: 0,
                    speed: 0,
                    retriesLeft: settings.retries,
                });
                existingUrls.add(link.url); // 立即添加到 Set，防止本次消息中的重复链接
            }
        }
        
        downloadTasks.add(uniqueNewTasks);
        _startTasks(uniqueNewTasks);

        openManagementPage(false);

    } else if (message.action === 'startTasks') {
        startTasks(message.taskIds);
    } else if (message.action === 'startAllTasks') {
        startAllTasks();
    } else if (message.action === 'pauseTasks') {
        pauseTasks(message.taskIds);
    } else if (message.action === 'pauseAllTasks') {
        pauseAllTasks();
    } else if (message.action === 'deleteTasks') {
        deleteTasks(message.taskIds);
    } else if (message.action === 'clearCompleteTasks') {
        clearCompleteTasks();
    } else if (message.action === 'clearAllTasks') {
        clearAllTasks();
    } else if (message.action === 'clearErrorTasks') {
        clearErrorTasks();
    }
});

function openManagementPage(act=true) {
    const managerUrl = chrome.runtime.getURL('management_page.html');
    chrome.tabs.query({ url: managerUrl }, (tabs) => {
        if (tabs.length > 0) {
            //chrome.tabs.update(tabs[0].id, { active: true });
        } else {
            chrome.tabs.create({ url: managerUrl,active: act});
        }
    });
}

chrome.action.onClicked.addListener((tab) => {
    openManagementPage(true);
});

chrome.runtime.onInstalled.addListener(() => {
    void resetDownloadUiState();
    chrome.contextMenus.create({
        id: "download-all-links",
        title: chrome.i18n.getMessage("bg_ctxMenu_downloadAll"),
        contexts: ["page"],
    });
    chrome.contextMenus.create({
        id: "download-selected-links",
        title: chrome.i18n.getMessage("bg_ctxMenu_downloadSelection"),
        contexts: ["selection"],
    });
    chrome.contextMenus.create({
        id: "separator",
        type: "separator",
        contexts: ["all"]
    });
    chrome.contextMenus.create({
        id: "open-management-page",
        title: chrome.i18n.getMessage("bg_ctxMenu_openManager"),
        contexts: ["all"],
    });
});

chrome.runtime.onStartup.addListener(() => {
    void resetDownloadUiState();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "open-management-page") {
        openManagementPage();
    } else if (["download-all-links", "download-selected-links"].includes(info.menuItemId)) {
        chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["content.js"],
        }).then(() => {
            const action = info.menuItemId === "download-all-links" ? "extractFromPage" : "extractFromSelection";
            chrome.tabs.sendMessage(tab.id, { action });
        }).catch(err => console.log("脚本注入失败:", err));
    }
});
