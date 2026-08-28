[CmdletBinding()]
param(
    [string]$BaseUrl = 'https://88api.ai'
)

$secureToken = Read-Host -Prompt '输入 88API 个人访问令牌（输入内容会隐藏）' -AsSecureString
if ($secureToken.Length -eq 0) {
    throw '未输入访问令牌，配置未改变。'
}

$tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
$plainToken = $null
try {
    $plainToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
    $headers = @{
        Authorization = "Bearer $plainToken"
        Accept = 'application/json'
    }
    $response = Invoke-RestMethod -Uri ($BaseUrl.TrimEnd('/') + '/api/user/self') -Headers $headers -Method Get
    if (-not $response.success -or -not $response.data.id) {
        throw '访问令牌验证失败：账户接口未返回有效用户。'
    }

    [Environment]::SetEnvironmentVariable(
        'SEEDANCE_STUDIO_ACCESS_TOKEN',
        $plainToken,
        [EnvironmentVariableTarget]::User
    )
    [Environment]::SetEnvironmentVariable(
        'SEEDANCE_STUDIO_USER_ID',
        [string]$response.data.id,
        [EnvironmentVariableTarget]::User
    )
}
finally {
    if ($tokenPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
    }
    $plainToken = $null
    $secureToken.Dispose()
}

Write-Host '个人访问令牌已验证，并保存到专用的 Windows 用户环境变量；未写入插件配置文件。'
