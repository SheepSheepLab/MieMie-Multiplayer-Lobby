export function createAttachmentPreview(doc: Document) {
  const dialog = doc.createElement('dialog');
  dialog.className = 'mm-lobby mm-attachment-preview';
  dialog.setAttribute('aria-labelledby', 'mm-attachment-name');
  const panel = doc.createElement('section');
  const title = doc.createElement('h2');
  title.id = 'mm-attachment-name';
  const label = doc.createElement('p');
  const content = doc.createElement('div');
  const actions = doc.createElement('footer');
  const download = doc.createElement('a');
  download.textContent = '下载附件';
  const done = doc.createElement('button');
  done.type = 'button';
  done.textContent = '返回';
  actions.append(download,done);
  panel.append(title,label,content,actions);
  dialog.append(panel);
  doc.body.append(dialog);

  function close() {
    if (dialog.open) dialog.close();
    content.replaceChildren();
    download.removeAttribute('href');
  }

  done.addEventListener('click',close);
  dialog.addEventListener('close',()=>{if(!dialog.open)close();});
  return {
    open(path: string,type: string,url: string) {
      const name = path.split('/').at(-1) ?? path;
      title.textContent = name;
      label.textContent = path;
      let media: HTMLImageElement | HTMLAudioElement;
      if (type.startsWith('image/')) {
        media = doc.createElement('img');
        media.alt = name;
      } else {
        media = doc.createElement('audio');
        media.controls = true;
      }
      media.src = url;
      content.replaceChildren(media);
      download.href = url;
      download.download = name;
      if (!dialog.open) dialog.showModal();
      done.focus({preventScroll:true});
    },
    close,
    dispose() {close();dialog.remove();},
  };
}
