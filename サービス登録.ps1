<#
.SYNOPSIS
    統合HILS予約サイトをタスクスケジューラに常駐登録する（初回登録／パスワード更新／権限引き継ぎ 共用）。

.DESCRIPTION
    「ログオン有無に関わらず実行」設定のタスクを登録し、指定アカウントの資格情報で
    node server.js を常駐実行させる。ログオフ・ユーザー切替をまたいでプロセスが
    生き続けるようにするための常駐化スクリプトである。

    以下のいずれの場面でも、本スクリプトを再実行すればよい。
      - 初回セットアップ
      - 実行アカウントのパスワード変更時（最後の変更から90日以内に変更必須のルールに対応）
      - 権限引き継ぎ時（実行アカウントを新担当者のアカウントへ差し替える）

    パスワードはファイルに保存せず、実行時にその場で入力させる
    （Register-ScheduledTask の仕様上、内部で一時的に平文へ変換されるが、変数はメモリ上のみに留まる）。

.NOTES
    管理者権限のPowerShellで実行すること。
#>

$taskName = "HILS予約サイト"
$appRoot  = $PSScriptRoot
$daemonBat = Join-Path $appRoot "_daemon.bat"

if (-not (Test-Path $daemonBat)) {
	Write-Error "起動用バッチが見つからない: $daemonBat"
	exit 1
}

Write-Output "=== 統合HILS予約サイト 常駐タスク登録 ==="
Write-Output "対象タスク名: $taskName"
Write-Output ""

# 実行アカウントの入力（既定は現在ログイン中のドメイン\アカウント。引き継ぎ時は新担当者のアカウントを入力する）
$defaultAccount = "$env:USERDOMAIN\$env:USERNAME"
$account = Read-Host "実行アカウントを入力してください（既定: $defaultAccount。そのまま Enter で既定を使用）"
if ([string]::IsNullOrWhiteSpace($account)) {
	$account = $defaultAccount
}

# パスワードは平文保存しない。SecureString で受け取り、登録処理の直前のみ平文化する。
$securePassword = Read-Host "$account のパスワードを入力してください" -AsSecureString
$bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
$plainPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
[System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

# 既存タスクがあれば一旦削除してから再登録する（パスワード更新・引き継ぎ時のアカウント差替に対応）
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
	Write-Output "既存タスクを検出。停止・削除して再登録する。"
	Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
	Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

$action = New-ScheduledTaskAction -Execute $daemonBat -WorkingDirectory $appRoot
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet `
	-AllowStartIfOnBatteries `
	-DontStopIfGoingOnBatteries `
	-ExecutionTimeLimit ([TimeSpan]::Zero) `
	-RestartCount 3 `
	-RestartInterval (New-TimeSpan -Minutes 1) `
	-MultipleInstances IgnoreNew

# 改修: -Principal と -User/-Password は同時指定不可（パラメーターセットが競合しAmbiguousParameterSetエラーになる）。
#       パスワード保存で「ログオン有無に関わらず実行」させるには -User/-Password/-RunLevel を直接指定する
#       （-Password指定時、LogonTypeは自動的にPasswordになる）。
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
	-Settings $settings -User $account -Password $plainPassword -RunLevel Limited -Force | Out-Null

# メモリ上の平文パスワードは使用後すぐに破棄する
$plainPassword = $null
[System.GC]::Collect()

Write-Output ""
Write-Output "登録完了。設定確認:"
schtasks /Query /TN $taskName /V /FO LIST | Select-String -Pattern "タスク名|実行するユーザー|状態|ログオン"

Write-Output ""
Write-Output "即時起動して動作確認する場合は次を実行:"
Write-Output "  schtasks /Run /TN `"$taskName`""
Write-Output "停止する場合:"
Write-Output "  schtasks /End /TN `"$taskName`""
