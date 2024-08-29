// This file is required by the index.html file and will
// be executed in the renderer process for that window.
// All of the Node.js APIs are available in this process.
const fs = require('fs')
const path = require('path')
const { dialog } = require('electron').remote;
const { spawn } = require('child_process');
const log = require('electron-log');

const fieldNames = require('./gui-config');
console.log('env', process.env.NODE_ENV);
const REL_PATH = process.env.NODE_ENV === 'development' ? '.' : '..';
const CONFIG_FOLDER = path.join(process.env.ProgramData, './DOLAS/PEGASUS-SERVICES/CONFIG');
const SYSTEM_APPDATA = 'C:\\Windows\\System32\\config\\systemprofile\\AppData\\Roaming\\DOLAS\\PEGASUS-SERVICES';
let CONFIG_PATH=''


function loadSelectors(){
    fieldNames.forEach(({ label, name, defaultVal, type, options }, i) => {
        if(name=='service_name' || name=='service_type'){
            const form = document.getElementById('config-form-container-' + i % 3);
            const container = document.createElement('div');
            container.setAttribute('class', 'form-field-container');
            container.setAttribute('id', name + '_id');
            const labelEl = document.createElement('label');
            labelEl.innerText = label;
            let input = document.createElement('input');
    
            
            if (type === 'select') {
                input = document.createElement('select');
                input.setAttribute('id', name);
                input.setAttribute('name', name);
                input.setAttribute('value', defaultVal);
                for (const option in options){
                    opt = options[option]
                    const optionEl = document.createElement('option');
                    optionEl.innerText = opt.label
                    optionEl.setAttribute('value',opt.value )
                    input.appendChild(optionEl)
                }
                container.appendChild(labelEl);
                container.appendChild(input);
            }
            else{
                input = document.createElement('input');
                input.setAttribute('name', name);
                input.setAttribute('list', 'existing_configs');
                input.setAttribute('value', defaultVal);
                input.setAttribute('id', name);
                existing_configs = document.createElement('datalist');
                existing_configs.setAttribute('id', 'existing_configs');
                existing_config = document.createElement('option');
                existing_config.setAttribute('value', 'equus-events-sender');
                existing_configs.appendChild(existing_config);
                container.appendChild(labelEl);
                container.appendChild(input);
                container.appendChild(existing_configs);
            } 
            form.appendChild(container);
        }
    })
    document.querySelector('#service_type_id').addEventListener('change', loadConfig)
    document.querySelector('#service_name_id').addEventListener('change', loadConfig)
}


function mkdirSyncRecursive(directory) {
    var path = directory.split('\\');
    log.info(path)
    for (var i = 1; i <= path.length; i++) {
        var segment = path.slice(0, i).join('\\');
        log.info(segment)
        segment.length > 0 && !fs.existsSync(segment) ? fs.mkdirSync(segment) : null ;
    }
};


function setup(CONFIG_FOLDER, CONFIG_PATH){
    if (!fs.existsSync(CONFIG_FOLDER)){
        log.info('Creating ProgramData/DOLAS/');
        try{
            mkdirSyncRecursive(CONFIG_FOLDER);
        }
        catch{
            log.info("failed mkdirsyncRecursive")
        }
    }
    else{
        log.info('ProgramData/DOLAS/ exists!')
    }
    try{
        fs.writeFileSync(CONFIG_PATH, JSON.stringify({}), { flag: 'wx' });
    }
    catch{}
}


function loadConfig(){
    serviceName = document.getElementsByName('service_name')[0].value
    serviceType = document.getElementsByName('service_type')[0].value
    console.log(serviceName)
    CONFIG_PATH = path.join(process.env.ProgramData, `./DOLAS/PEGASUS-SERVICES/CONFIG/${serviceName}.json`);
    log.info('config path ', CONFIG_PATH)
    setup(CONFIG_FOLDER,CONFIG_PATH)
    document.getElementById('config-form-container-0').innerHTML=''
    document.getElementById('config-form-container-1').innerHTML=''
    document.getElementById('config-form-container-2').innerHTML=''
    loadSelectors()
    serviceName = document.getElementsByName('service_name')[0].value=serviceName
    serviceType = document.getElementsByName('service_type')[0].value=serviceType
    fs.readFile(CONFIG_PATH, (err, rawData) => {
        const data = rawData.toString();
        const config = JSON.parse(data);
    
        fieldNames.forEach(({ label, name, defaultVal, type, options }, i) => {
            const value = config[name] !== undefined ? config[name] : defaultVal;
            if(name=='service_name' || name=='service_type'){
            }
            else{
            
                const form = document.getElementById('config-form-container-' + i % 3);
                const container = document.createElement('div');
                    
                container.setAttribute('class', 'form-field-container');
                container.setAttribute('id', name + '_id');
        
                const labelEl = document.createElement('label');
                labelEl.innerText = label;
        
                let input = document.createElement('input');
        
                if (type === 'select') {
                    input = document.createElement('select');
                    input.setAttribute('id', name);
                    input.setAttribute('name', name);
                    input.setAttribute('value', value.value || value);
                    for (const option in options){
                        opt = options[option]
                        const optionEl = document.createElement('option');
                        optionEl.innerText = opt.label
                        optionEl.setAttribute('value',opt.value )
                        input.appendChild(optionEl)
                    }
                }
                else{
                    input = document.createElement('input');
                    input.setAttribute('name', name);
                    input.setAttribute('value', value);
                } 
        
                if (type === 'password') {
                    input.setAttribute('type', 'password');
                }
        
                if (type === 'toggle') {
                    input.setAttribute('type', 'checkbox');
                    input.setAttribute('id', name);
                    if (value === true) {
                        input.setAttribute('checked', true);
                    }
                }
                container.appendChild(labelEl);
                container.appendChild(input);
                form.appendChild(container);
            }
        })
    })
}


function showError(e) {
    const errorNode = document.getElementById('error-container');
    errorNode.innerText = e;
    errorNode.style.display = 'block'
    setTimeout(() => {
        successNode.style.display = 'none'
    }, 5000); 
}

function hideError() {
    const errorNode = document.getElementById('error-container');
    errorNode.innerText = '';
    errorNode.style.display = 'none'
}

function showSuccess() {
    hideError();
    const successNode = document.getElementById('success-container');
    successNode.innerText = 'Success!';
    successNode.style.display = 'block'
    successNode.style.color = 'green'
    setTimeout(() => {
        successNode.style.display = 'none'
    }, 4000); 
}

function showMsg(m, timedClear=true) {
    hideError();
    const successNode = document.getElementById('success-container');
    successNode.innerText = m;
    successNode.style.display = 'block'
    successNode.style.color = 'blue'
    if(timedClear){
        setTimeout(() => {
            successNode.style.display = 'none'
        }, 5000); 
    }
}

/**
 * EVENT CALLBACKS
 */
function save(event) {
    showMsg('saving...')
    event.preventDefault();
    const config = {};
    const inputFields = Array.from(document.getElementsByTagName('input')).concat(Array.from(document.getElementsByTagName('select')))
    for (let i = 0; i < inputFields.length; i++) {
        const input = inputFields[i];
        config[input.name] = input.value;
        if (input.type === 'checkbox') {
            config[input.name] = input.checked ? true : false;
        }
    }
    
    fs.writeFile(CONFIG_PATH, JSON.stringify(config,null,'\t'), (err) => {
        if (err) {
            showError('Failed to save');
        } else {
            showSuccess();
        }
    })
}

var logSubProcess = function(subProcess) {
  return new Promise(function(resolve, reject) {
    const errors = [];
    subProcess.stderr.on('data', (data) => {
        log.error(`stderr: ${data}`);
        errors.push(data);
    });
    subProcess.stdout.on('data', (data) => {
        log.info(`stdout: ${data}`);
    });
    subProcess.on('error', (e) => {
        log.error(e);
        errors.push(e);
    });
    subProcess.on('close', (code) => {
        if (errors.length) {
            dialog.showErrorBox('ERROR', errors.join('/n'));
            resolve("Had Errors...");
        } else if (code !== 0) {
            dialog.showErrorBox('ERROR', 'Process failed');
            resolve("Had Errors...");
        }
        else {
            showSuccess()
            resolve("Success!");
        }
    });  
  });
}

function logCurrentErrors(subProcess) {
    const errors = [];
    const errorList = document.getElementById('error-list');
    subProcess.stderr.on('data', (data) => {
        errors.push(`stderr: ${data}`);
        log.error(`stderr: ${data}`);
        errorList.innerHTML = '';
        errors.forEach((err) => {
            const error = document.createElement('div');
            error.innerText = err;
            errorList.appendChild(error);
        });
    });
}


/***************Button Hanlders***************/ 

function runApp() {
    showMsg('Starting service...')
    let nssm = ''
    if (process.env.NODE_ENV === 'development'){
        nssm = '"'+path.join(__dirname, REL_PATH, '../nssm.exe')+'"'; 
    }
    else{
        nssm = '"'+path.join(__dirname, REL_PATH, '../resources/nssm.exe')+'"'; 
    }
    const service_name = `"DOLAS-${serviceName}"`
    logSubProcess(spawn(nssm, ['start', service_name],{detached: false, shell: true}));

}

function stopApp() {
    showMsg('Stopping service...')
    let nssm = ''
    if (process.env.NODE_ENV === 'development'){
        nssm = '"'+path.join(__dirname, REL_PATH, '../nssm.exe')+'"'; 
    }
    else{
        nssm = '"'+path.join(__dirname, REL_PATH, '../resources/nssm.exe')+'"'; 
    }
    const service_name = `"DOLAS-${serviceName}"`
    logSubProcess(spawn(nssm, ['stop', service_name],{detached: false, shell: true}));
}

function checkIfAppIsRunning() {
    const subProcess = spawn('net', ['status', serviceName]);
    subProcess.on('error', (e) => {

    });
    subProcess.stdout.on('data', (data) => {
        if (data === 'SERVICE_START') {
            document.getElementById('btn-run-app').setAttribute('disabled');
            logCurrentErrors(subProcess);
        }
    })
}

function setupDB() {
    showMsg('Setting up database')
    log.info('starting setupDB');
    let python_exe=''
    let args=[]
    const app_path = '"'+path.join(__dirname, REL_PATH, '../../service/app.py')+'"';

    if (process.env.NODE_ENV === 'development'){
        python_exe = '"'+path.join(__dirname, REL_PATH, '../../service/python368/python.exe')+'"';
        args = [app_path,'-setup_db' , '"'+CONFIG_PATH+'"'] ;
    }
    else{
        python_exe = '"'+path.join(__dirname, REL_PATH, '../resources/pegII-service.exe')+'"';
        args = ['-setup_db' , '"'+CONFIG_PATH+'"'] ;
    }

    logSubProcess(spawn(python_exe, [...args],{detached: true, shell: true}));
}


function setupService() {
    log.info('starting setupService');
    let python_exe=''
    let args=[]
    let nssm=''
    const app_path = '"\\"' + path.join(__dirname, REL_PATH, '../../service/app.py') + '\\""'; 
    const service_name = `"DOLAS-${serviceName}"`

    if (process.env.NODE_ENV === 'development'){
        nssm = '"'+path.join(__dirname, REL_PATH, '../nssm.exe')+'"';
        python_exe = '"'+path.join(__dirname, REL_PATH, '../../service/python368/python.exe')+'"';
        args = ['install', service_name, python_exe, app_path,'\\"-run\\"', '"\\"'+CONFIG_PATH+'\\""'];
    }
    else{
        nssm = '"'+path.join(__dirname, REL_PATH, '../resources/nssm.exe')+'"';
        python_exe = '"'+path.join(__dirname, REL_PATH, '../resources/pegII-service.exe')+'"';
        args = ['install', service_name, python_exe,'\\"-run\\"', '"\\"'+CONFIG_PATH+'\\""'];

    }
    

    console.log(nssm)
    console.log(python_exe)
    console.log(app_path)
    console.log(...args)

    testAPI().then(function(){
        log.info('Stopping old service');
        showMsg('Stopping old service');
        logSubProcess(spawn(nssm, ['stop', service_name],{detached: false, shell: true})).then(function(){
            log.info('Removing old service');
            showMsg('Removing old service');
            logSubProcess(spawn(nssm, ['remove', service_name, 'confirm'],{detached: false, shell: true})).then(function(){
                log.info('Installing service');
                showMsg('Installing service');
                logSubProcess(spawn(nssm, [...args],{detached: true, shell: true})).then(function(){
                    log.info('Set delayed start');
                    showMsg('Set delayed start');       
                    logSubProcess(spawn(nssm, ['set', service_name, 'Start', 'SERVICE_DELAYED_AUTO_START'],{detached: false, shell: true})).then(function(){
                        log.info('Set description');
                        showMsg('Set description');
                        logSubProcess(spawn(nssm, ['set', service_name, 'Description', service_name],{detached: true, shell: true}))           
                    });
                });
            });
        });
    });
}

function tailLogs(){
    log.info('tailing logs');
    const debug_log = '"' + path.join(SYSTEM_APPDATA, `./${serviceName}/LOGS/debug.log`) + '"';
    console.log(debug_log)
    spawn("powershell", ['Get-Content','-Path',debug_log,'-Tail','100','-Wait'],{detached: true, shell: true})

}

var testAPI = function(){
    return new Promise(function(resolve,reject){
        showMsg('Testing API Config')
        log.info('Testing API Config');
        let python_exe=''
        let args=[]
        const app_path = '"'+path.join(__dirname, REL_PATH, '../../service/app.py')+'"';
        if (process.env.NODE_ENV === 'development'){
            python_exe = '"'+path.join(__dirname, REL_PATH, '../../service/python368/python.exe')+'"';
            args = [app_path, '-test_api','"'+CONFIG_PATH+'"']
        }
        else{
            python_exe = '"'+path.join(__dirname, REL_PATH, '../resources/pegII-service.exe')+'"';
            args = ['-test_api','"'+CONFIG_PATH+'"']
        }
        logSubProcess(spawn(python_exe, [...args],{detached: true, shell: true})).then(function(){
            resolve('Promise Resolved')
        });
        
    });
}

function runDebug() {
    log.info('running in debug mode');
    let python_exe=''
    let more_args=[]
    const app_path = '"'+path.join(__dirname, REL_PATH, '../../service/app.py')+'"';

    if (process.env.NODE_ENV === 'development'){
        python_exe = '"'+path.join(__dirname, REL_PATH, '../../service/python368/python.exe')+'"';
        more_args = [app_path, '-run_debug', '"'+CONFIG_PATH+'"'];
    }
    else{
        python_exe = '"'+path.join(__dirname, REL_PATH, '../resources/pegII-service.exe')+'"';
        more_args = ['-run_debug', '"'+CONFIG_PATH+'"'];
    }

    logSubProcess(spawn(python_exe,[...more_args],{detached: true, shell: true}));
    showMsg('running in debug mode...', timedClear=false)
}


function testSMTP(){
    log.info('testing SMTP')
    let python_exe=''
    let more_args=[]
    const app_path = '"'+path.join(__dirname, REL_PATH, '../../service/app.py')+'"';
    if (process.env.NODE_ENV === 'development'){
        python_exe = '"'+path.join(__dirname, REL_PATH, '../../service/python368/python.exe')+'"';

        more_args = [app_path, '-run_debug', '"'+CONFIG_PATH+'"'];
    }
    else{
        python_exe = '"'+path.join(__dirname, REL_PATH, '../resources/pegII-service.exe')+'"';
        more_args = ['-test_smtp', '"'+CONFIG_PATH+'"'];  
    }

    logSubProcess(spawn(python_exe,[...more_args],{detached: true, shell: true}));
    showMsg('Testing SMTP... Check email for success confirmation', timedClear=true)
}

/**
 * EVENTS
 */

loadSelectors()

document.querySelector('#btn-save').addEventListener('click', save)
document.querySelector('#btn-run-app').addEventListener('click', runApp)
document.querySelector('#btn-stop-app').addEventListener('click', stopApp)
document.querySelector('#btn-setup-db').addEventListener('click', setupDB)
document.querySelector('#btn-setup-service').addEventListener('click', setupService)
document.querySelector('#btn-run-debug').addEventListener('click', runDebug)
document.querySelector('#btn-test-smtp').addEventListener('click', testSMTP)
document.querySelector('#btn-tail-logs').addEventListener('click', tailLogs)
