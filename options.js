const textarea = document.getElementById("dict");
const status = document.getElementById("status");

chrome.storage.local.get(["userDict"], (data) => {
  textarea.value = JSON.stringify(data.userDict || {}, null, 2);
});

document.getElementById("save").addEventListener("click", () => {
  try {
    const userDict = JSON.parse(textarea.value || "{}");
    chrome.storage.local.set({ userDict }, () => {
      status.textContent = "保存しました。ページを再読み込みすると反映されます。";
    });
  } catch (e) {
    status.textContent = "JSONの形式が正しくありません。";
  }
});
