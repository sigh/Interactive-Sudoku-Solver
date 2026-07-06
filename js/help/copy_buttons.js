const { copyToClipboard } = await import('../util.js' + self.VERSION_PARAM);

export const addCopyButtonsToCodeBlocks = () => {
  const codeBlocks = document.querySelectorAll('.help-content pre');
  for (const pre of codeBlocks) {
    if (pre.querySelector('button.copy-button')) continue;

    pre.classList.add('code-with-copy');

    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-button plain-button';
    copyBtn.title = 'Copy to clipboard';

    const copyIcon = document.createElement('img');
    copyIcon.src = '../img/copy-48.png';
    copyBtn.appendChild(copyIcon);

    copyBtn.addEventListener('click', (e) => {
      copyToClipboard(pre.textContent, copyBtn);
    });

    pre.insertBefore(copyBtn, pre.firstChild);
  }
};
