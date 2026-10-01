import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as NativeApp } from '@capacitor/app';

const details: Record<string, string> = {
  错题本: '这里将按孩子整理已经校对的错题，保留原题和原作答，方便回看。',
  分步辅导: '这里将围绕已经校对的题目逐步给提示，帮助孩子继续推理。',
  举一反三: '这里将提供同一知识点的变式题，记录孩子独立作答的过程。',
  学习报告: '这里将汇总孩子的练习与复习记录，帮助家长了解学习进展。',
};
export function FeatureDialog({ feature, onClose, onContinue }: { feature: string; onClose: () => void; onContinue: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const listener = NativeApp.addListener('backButton', onClose);
    return () => { void listener.then((handle) => handle.remove()); };
  }, [onClose]);
  return <dialog ref={dialog} className="feature-dialog" aria-labelledby="feature-heading" onClose={onClose}>
    <span className="eyebrow">准备中</span><h2 id="feature-heading">{feature}</h2>
    <p>{details[feature] || '这项功能正在准备中。'}</p>
    <p>当前可以先拍题、上传和校对，原图与手写步骤会分别保存在孩子的资料里。</p>
    <div className="button-row"><button type="button" className="primary" onClick={onContinue}>继续拍题</button><button type="button" onClick={onClose}>返回首页</button></div>
  </dialog>;
}
