#define MyAppName "木辛说视频下载器"
#define MyAppVersion "0.1.0"
#define MyAppExeName "木辛说视频下载器.exe"
[Setup]
AppId={{B61EAF6A-9195-4D2C-8A1E-85CAFA71780D}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher=木辛说
DefaultDirName={localappdata}\Programs\MuxinVideoDownloader
DefaultGroupName={#MyAppName}
OutputDir=..\release
OutputBaseFilename=木辛说视频下载器-Setup-x64
Compression=lzma2/ultra64
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
WizardStyle=modern
SetupIconFile=..\assets\app-icon\app-icon.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
SetupLogging=yes
[Languages]
Name: "chinesesimp"; MessagesFile: ".\ChineseSimplified.isl"
[Files]
Source: "..\release\app\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
[Dirs]
Name: "{app}\videos"; Permissions: users-modify
[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon
[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "快捷方式："; Flags: unchecked
[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "启动 {#MyAppName}"; Flags: nowait postinstall skipifsilent
[Code]
var DeleteDataCheck: TNewCheckBox;
procedure InitializeUninstallProgressForm();
begin
  if UninstallSilent then Exit;
  DeleteDataCheck := TNewCheckBox.Create(UninstallProgressForm);
  DeleteDataCheck.Parent := UninstallProgressForm;
  DeleteDataCheck.Left := UninstallProgressForm.StatusLabel.Left;
  DeleteDataCheck.Top := UninstallProgressForm.StatusLabel.Top + 42;
  DeleteDataCheck.Width := UninstallProgressForm.ClientWidth - DeleteDataCheck.Left * 2;
  DeleteDataCheck.Caption := '同时删除配置、登录资料和 Whisper 模型（不会删除已下载视频）';
  DeleteDataCheck.Checked := False;
end;
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if (CurUninstallStep = usPostUninstall) and Assigned(DeleteDataCheck) and DeleteDataCheck.Checked then
    DelTree(ExpandConstant('{localappdata}\MuxinVideoDownloader'), True, True, True);
end;
