document.addEventListener('DOMContentLoaded', () => {
    const concurrencyInput = document.getElementById('concurrency');
    const intervalInput = document.getElementById('interval');
    const retriesInput = document.getElementById('retries');
    const saveBtn = document.getElementById('saveBtn');
    const statusDiv = document.getElementById('statusDiv');

    // 加载已保存的设置
    function restoreOptions() {
        chrome.storage.sync.get({
            concurrency: 3,
            interval: 500,
            retries: 3
        }, (items) => {
            concurrencyInput.value = items.concurrency;
            intervalInput.value = items.interval;
            retriesInput.value = items.retries;
        });
    }

    // 保存设置
    function saveOptions() {
        const concurrency = parseInt(concurrencyInput.value, 10);
        const interval = parseInt(intervalInput.value, 10);
        const retries = parseInt(retriesInput.value, 10);

        chrome.storage.sync.set({
            concurrency: concurrency,
            interval: interval,
            retries: retries
        }, () => {
            statusDiv.textContent = chrome.i18n.getMessage('options_saveSuccess');
            setTimeout(() => { statusDiv.textContent = ''; }, 1500);
        });
    }

    saveBtn.addEventListener('click', saveOptions);
    restoreOptions();
});