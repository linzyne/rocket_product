// 자동 로그인 정보(쿠팡 서허·광고, 롯데 ALPS). chrome.storage.local에만 두고(동기화 저장소·앱·클라우드로 보내지 않음)
// coupang-login.js·lotte.js가 로그인 화면에서 읽어 씁니다.
const $ = (id) => document.getElementById(id);

const setup = (key, prefix) => {
  const idEl = $(`${prefix}id`);
  const pwEl = $(`${prefix}pw`);
  const show = (text, ok = true) => {
    $(`${prefix}msg`).textContent = text;
    $(`${prefix}msg`).style.color = ok ? '#059669' : '#dc2626';
  };

  chrome.storage.local.get(key, (r) => {
    const c = r && r[key];
    if (c) {
      idEl.value = c.id || '';
      pwEl.value = c.pw || '';
      show('저장된 정보가 있어요.');
    }
  });

  $(`${prefix}save`).addEventListener('click', () => {
    const id = idEl.value.trim();
    const pw = pwEl.value;
    if (!id || !pw) return show('아이디와 비밀번호를 모두 넣어주세요.', false);
    chrome.storage.local.set({ [key]: { id, pw } }, () => show('저장했어요. 이제 로그인 화면이 뜨면 자동으로 로그인해요.'));
  });

  $(`${prefix}clear`).addEventListener('click', () => {
    chrome.storage.local.remove(key, () => {
      idEl.value = '';
      pwEl.value = '';
      show('지웠어요.');
    });
  });
};

setup('coupangCredentials', 'c');
setup('lotteCredentials', '');
