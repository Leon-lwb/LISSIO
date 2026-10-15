# Read mandatory-label SIDs through Windows APIs, independently of display language.
# Get-Acl without audit privileges omits these labels from its SDDL output.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;

public static class LissioArtifactIntegrity
{
    [StructLayout(LayoutKind.Sequential)]
    private struct AclSize { public uint Count, Used, Free; }

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
    private static extern uint GetNamedSecurityInfoW(string name, uint type, uint info,
        out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetAclInformation(IntPtr acl, out AclSize size, uint length, uint info);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetAce(IntPtr acl, uint index, out IntPtr ace);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetTokenInformation(IntPtr token, uint info, IntPtr buffer,
        uint length, out uint required);
    [DllImport("kernel32.dll")]
    private static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr memory);

    public static string FileSid(string path)
    {
        IntPtr owner, group, dacl, sacl, descriptor;
        uint error = GetNamedSecurityInfoW(path, 1, 0x10,
            out owner, out group, out dacl, out sacl, out descriptor);
        if (error != 0) throw new Win32Exception((int)error, path);
        try
        {
            // Unlabeled objects have Medium integrity. Never infer this on API failure.
            uint rid = 8192;
            if (sacl != IntPtr.Zero)
            {
                AclSize size;
                if (!GetAclInformation(sacl, out size, (uint)Marshal.SizeOf(typeof(AclSize)), 2))
                    throw new Win32Exception(Marshal.GetLastWin32Error());
                bool found = false;
                for (uint index = 0; index < size.Count; index++)
                {
                    IntPtr ace;
                    if (!GetAce(sacl, index, out ace))
                        throw new Win32Exception(Marshal.GetLastWin32Error());
                    // SYSTEM_MANDATORY_LABEL_ACE, excluding INHERIT_ONLY_ACE.
                    if (Marshal.ReadByte(ace) != 17 || (Marshal.ReadByte(ace, 1) & 8) != 0) continue;
                    string sid = new SecurityIdentifier(IntPtr.Add(ace, 8)).Value;
                    uint candidate = UInt32.Parse(sid.Substring(sid.LastIndexOf('-') + 1));
                    if (!found || candidate < rid) rid = candidate;
                    found = true;
                }
            }
            return "S-1-16-" + rid;
        }
        finally { LocalFree(descriptor); }
    }

    public static string ProcessSid()
    {
        IntPtr token;
        if (!OpenProcessToken(GetCurrentProcess(), 8, out token))
            throw new Win32Exception(Marshal.GetLastWin32Error());
        try
        {
            uint required;
            GetTokenInformation(token, 25, IntPtr.Zero, 0, out required);
            if (required == 0) throw new Win32Exception(Marshal.GetLastWin32Error());
            IntPtr buffer = Marshal.AllocHGlobal((int)required);
            try
            {
                if (!GetTokenInformation(token, 25, buffer, required, out required))
                    throw new Win32Exception(Marshal.GetLastWin32Error());
                return new SecurityIdentifier(Marshal.ReadIntPtr(buffer)).Value;
            }
            finally { Marshal.FreeHGlobal(buffer); }
        }
        finally { CloseHandle(token); }
    }
}
'@

$requestedPaths = ConvertFrom-Json $env:LISSIO_INTEGRITY_PATHS
$labels = @($requestedPaths | ForEach-Object {
    [pscustomobject]@{ path = $_; sid = [LissioArtifactIntegrity]::FileSid($_) }
})
[pscustomobject]@{
    processSid = [LissioArtifactIntegrity]::ProcessSid()
    paths = $labels
} | ConvertTo-Json -Depth 4 -Compress
