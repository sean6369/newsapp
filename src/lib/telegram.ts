export function shareViaTelegram(shareUrl: string, title: string) {
  const url = encodeURIComponent(shareUrl);
  const text = encodeURIComponent(title);
  const webUrl = `https://t.me/share/url?url=${url}&text=${text}`;
  const nativeUrl = `tg://msg_url?url=${url}&text=${text}`;

  let appOpened = false;
  const onBlur = () => { appOpened = true; };
  window.addEventListener("blur", onBlur);

  window.location.href = nativeUrl;

  setTimeout(() => {
    window.removeEventListener("blur", onBlur);
    if (!appOpened && !document.hidden) {
      window.open(webUrl, "_blank");
    }
  }, 1500);
}
