document.addEventListener('DOMContentLoaded', () => {
    const tasksBtn = document.getElementById('nav-tasks');
    const settingsBtn = document.getElementById('nav-settings');
    const contentFrame = document.getElementById('content-frame');

    tasksBtn.addEventListener('click', () => {
        contentFrame.src = 'manage.html';
        tasksBtn.classList.add('active');
        settingsBtn.classList.remove('active');
    });

    settingsBtn.addEventListener('click', () => {
        contentFrame.src = 'options.html';
        settingsBtn.classList.add('active');
        tasksBtn.classList.remove('active');
    });
});