import sys
import os


def setupPath():
    print('Running setupPath()')
    dirname = os.path.dirname(__file__)
    path_add_lis = []
    path_add_lis.append(dirname)  # \pegasus-api-receiver\pegasus-api-receiver
    path_add_lis.append(os.path.join(dirname, r'./python368'))  # \pegasus-api-receiver\python368
    path_add_lis.append(os.path.join(dirname, r'./python368/site-packages'))  # \pegasus-api-receiver\python368\site-packages
    path_add_lis.append(os.path.join(dirname, r'./python368/tcl8.6'))  # \pegasus-api-receiver\python368\tcl8.6
    for path in path_add_lis:
        sys.path.append(path)
        # print(path, ' added to path')


def setFileSystem(service_name):
    service_name = service_name.upper()
    try:
        appDataPath = os.environ["APPDATA"] + f"\\DOLAS\\PEGASUS-SERVICES\\{service_name}\\"
        logsPath = os.environ["APPDATA"] + f"\\DOLAS\\PEGASUS-SERVICES\\{service_name}\\LOGS\\"
        configPath = os.environ["PROGRAMDATA"] + "\\DOLAS\\PEGASUS-SERVICES\\CONFIG\\"
        if not os.path.exists(appDataPath):
            os.makedirs(appDataPath)
        else:
            pass
        if not os.path.exists(logsPath):
            os.makedirs(logsPath)
        else:
            pass
        if not os.path.exists(configPath):
            os.makedirs(configPath)
        else:
            pass
    except Exception as e:
        print('Appdata Folder setup failed with error: ' + e)
