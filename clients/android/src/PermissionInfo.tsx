import { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { openAppSettings } from './permissions';

export function PermissionInfo() {
  const [error, setError] = useState('');
  return <details className="permission-info">
    <summary>权限与隐私</summary>
    <p>只在你使用相应功能时打开系统操作，不在启动或登录时索取权限。</p>
    <dl>
      <dt>拍照</dt><dd>点“拍照收题”才打开系统相机，使用本次拍下的照片。</dd>
      <dt>相册</dt><dd>点“相册选图”或云盘选图才打开系统选择器，仅使用你选中的图片。“按文件夹选范围”仅列出你授权文件夹中的图片，确认范围后再导入。</dd>
      <dt>图片云盘</dt><dd>你主动开始上传后，将所选原图复制到家庭服务器。下载原图时，由你选择手机保存位置。</dd>
      <dt>安装更新</dt><dd>点“下载并安装”后才检查安装许可；是否授权、安装由你确认，拒绝不影响学习。</dd>
      <dt>联网</dt><dd>用于家庭登录、上传、识别和检查版本。联网属于普通权限，不单独弹出授权框。</dd>
      <dt>短信等其他权限</dt><dd>应用不声明或申请短信、通讯录、电话、定位、麦克风和全盘文件访问权限。</dd>
    </dl>
    <p>拍照后先保存在本机，确认上传后才发送到家庭服务器。云盘保存原图，不自动启动 AI 识别。相机或系统选择器自己的权限由系统管理。</p>
    {Capacitor.isNativePlatform() && <button type="button" onClick={async () => {
      try { setError(''); await openAppSettings(); }
      catch { setError('未能打开系统设置。请在手机设置 → 应用管理 → 知燃 AI 中查看。'); }
    }}>查看系统应用设置</button>}
    {error && <p role="alert">{error}</p>}
  </details>;
}
