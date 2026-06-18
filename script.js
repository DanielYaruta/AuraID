/* ===================================================================
   AuraID — логика форм входа, регистрации и восстановления пароля
   Разделы:
   1. Тёмная тема (переключатель + сохранение выбора)
   2. Переключение табов / панелей (Вход / Регистрация / Восстановление)
   3. Показ/скрытие пароля
   4. Caps Lock — предупреждение в полях пароля
   5. Состояние загрузки кнопки (имитация запроса к серверу)
   6. Валидация формы входа
   7. Валидация формы регистрации + оценка сложности пароля
   8. Восстановление пароля
   9. OAuth-кнопки (заглушки)
   =================================================================== */

   (() => {
    "use strict";
  
    /* -----------------------------------------------------------------
                 Утилиты
              ----------------------------------------------------------------- */
  
    const THEME_KEY = "auraid-theme";
    const FAKE_REQUEST_MS = 900; // имитация задержки сети
  
    function setError(input, errorEl, message) {
      input.classList.toggle("is-invalid", Boolean(message));
      input.classList.toggle("is-valid", !message && input.value.length > 0);
      input.setAttribute("aria-invalid", message ? "true" : "false");
      if (errorEl) errorEl.textContent = message || "";
    }
  
    function getErrorEl(input) {
      const id = input.getAttribute("aria-describedby");
      if (!id) return null;
      // aria-describedby может содержать несколько id через пробел —
      // ищем тот, что заканчивается на -error
      const ids = id.split(/\s+/);
      for (const single of ids) {
        if (single.endsWith("-error")) {
          return document.getElementById(single);
        }
      }
      return null;
    }
  
    // Сбрасывает статус формы (используется при любом новом вводе после ошибки)
    function resetStatus(statusEl) {
      if (!statusEl) return;
      statusEl.classList.remove("is-success", "is-error");
      statusEl.innerHTML = "";
    }
  
    // Включает/выключает состояние загрузки на кнопке submit
    function setLoading(button, isLoading) {
      button.classList.toggle("is-loading", isLoading);
      button.disabled = isLoading;
      const label = button.querySelector(".btn__label");
      if (label)
        label.dataset.original = label.dataset.original || label.textContent;
    }
  
    function setButtonLabel(button, text) {
      const label = button.querySelector(".btn__label");
      if (label) label.textContent = text;
    }
  
    function restoreButtonLabel(button) {
      const label = button.querySelector(".btn__label");
      if (label && label.dataset.original)
        label.textContent = label.dataset.original;
    }
  
    // SVG-галочка, которая "дорисовывается" при успешной отправке формы.
    const SUCCESS_CHECK_SVG = `<svg class="form__status__check" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <path d="M7.5 12.5l3 3 6-6.5" />
      </svg>`;
  
    // Показывает статус успеха с анимированной галочкой перед текстом.
    function showSuccess(statusEl, message) {
      statusEl.classList.remove("is-error");
      statusEl.classList.add("is-success");
      statusEl.innerHTML = SUCCESS_CHECK_SVG + "<span>" + message + "</span>";
    }
  
    // Показывает статус ошибки и слегка трясёт карточку формы — но только
    // если пользователь не просил уменьшенную анимацию.
    const prefersReducedMotion =
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  
    function showError(statusEl, message, formEl) {
      statusEl.classList.remove("is-success");
      statusEl.classList.add("is-error");
      statusEl.textContent = message;
  
      if (prefersReducedMotion) return;
      const card =
        (formEl && formEl.closest(".card")) ||
        document.getElementById("mainCard");
      if (!card) return;
      card.classList.remove("is-shaking");
      // Перезапуск анимации требует "сброса" через reflow, если ошибка
      // показывается повторно подряд.
      // eslint-disable-next-line no-unused-expressions
      card.offsetWidth;
      card.classList.add("is-shaking");
      card.addEventListener(
        "animationend",
        () => card.classList.remove("is-shaking"),
        { once: true }
      );
    }
  
    /* -----------------------------------------------------------------
                 1. Тёмная тема
              ----------------------------------------------------------------- */
  
    const themeToggle = document.getElementById("themeToggle");
    const sunIcon = themeToggle.querySelector(".icon--sun");
    const moonIcon = themeToggle.querySelector(".icon--moon");
  
    function applyTheme(theme) {
      document.documentElement.setAttribute("data-theme", theme);
      const isDark = theme === "dark";
      themeToggle.setAttribute("aria-pressed", String(isDark));
      themeToggle.setAttribute(
        "aria-label",
        isDark ? "Включить светлую тему" : "Включить тёмную тему"
      );
      sunIcon.hidden = isDark;
      moonIcon.hidden = !isDark;
    }
  
    function initTheme() {
      let saved = null;
      try {
        saved = localStorage.getItem(THEME_KEY);
      } catch (err) {
        // localStorage может быть недоступен (приватный режим и т.п.) — это ок
      }
      const prefersDark =
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches;
      applyTheme(saved || (prefersDark ? "dark" : "light"));
    }
  
    themeToggle.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme");
      const next = current === "dark" ? "light" : "dark";
      applyTheme(next);
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch (err) {
        // если сохранить не получилось — тема просто не запомнится, не критично
      }
    });
  
    initTheme();
  
    /* -----------------------------------------------------------------
                 2. Переключение табов / панелей
              ----------------------------------------------------------------- */
  
    const tabLogin = document.getElementById("tab-login");
    const tabRegister = document.getElementById("tab-register");
    const panelLogin = document.getElementById("panel-login");
    const panelRegister = document.getElementById("panel-register");
    const panelRecover = document.getElementById("panel-recover");
    const panelTerms = document.getElementById("panel-terms");
    const authTabs = document.getElementById("authTabs");
    const announcer = document.getElementById("tabAnnouncer");
    const tabsIndicator = document.getElementById("tabsIndicator");
  
    const panels = {
      login: panelLogin,
      register: panelRegister,
      recover: panelRecover,
      terms: panelTerms,
    };
  
    // Панели, у которых нет собственных табов (показываются "поверх" форм)
    const STANDALONE_PANELS = ["recover", "terms"];
  
    // Передвигает скользящую полоску под активный таб через CSS-переменные.
    // Работает и при первой загрузке, и при ресайзе окна.
    function moveTabsIndicator(tabBtn) {
      if (!tabsIndicator || !tabBtn) return;
      const x = tabBtn.offsetLeft;
      const w = tabBtn.offsetWidth;
      authTabs.style.setProperty("--indicator-x", x + "px");
      authTabs.style.setProperty("--indicator-w", w + "px");
    }
  
    function activateTab(target) {
      const showLogin = target === "login";
      const showRegister = target === "register";
      const isStandalone = STANDALONE_PANELS.includes(target);
  
      // Табы видимы только для входа/регистрации; для отдельных панелей — скрываем
      authTabs.hidden = isStandalone;
  
      tabLogin.classList.toggle("is-active", showLogin);
      tabLogin.setAttribute("aria-selected", String(showLogin));
      tabLogin.tabIndex = showLogin ? 0 : -1;
  
      tabRegister.classList.toggle("is-active", showRegister);
      tabRegister.setAttribute("aria-selected", String(showRegister));
      tabRegister.tabIndex = showRegister ? 0 : -1;
  
      if (!isStandalone) {
        moveTabsIndicator(showLogin ? tabLogin : tabRegister);
      }
  
      Object.entries(panels).forEach(([key, panel]) => {
        panel.hidden = key !== target;
      });
  
      if (announcer) {
        const messages = {
          login: "Открыта форма входа",
          register: "Открыта форма регистрации",
          recover: "Открыта форма восстановления пароля",
          terms: "Открыты условия использования",
        };
        announcer.textContent = messages[target] || "";
      }
  
      // Удобство: сразу ставим фокус на первое поле открытой формы (если есть)
      const panel = panels[target];
      const firstField = panel.querySelector(".field__input");
      if (firstField) {
        firstField.focus({ preventScroll: true });
      } else {
        panel.focus({ preventScroll: true });
      }
    }
  
    tabLogin.addEventListener("click", () => activateTab("login"));
    tabRegister.addEventListener("click", () => activateTab("register"));
  
    // Стрелками тоже можно переключаться между табами (паттерн ARIA tabs)
    [tabLogin, tabRegister].forEach((tabBtn) => {
      tabBtn.addEventListener("keydown", (e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          activateTab(tabBtn === tabLogin ? "register" : "login");
        }
      });
    });
  
    // Ссылки внутри форм ("Зарегистрируйтесь" / "Войдите" / "Забыли пароль?")
    document.querySelectorAll("[data-go]").forEach((btn) => {
      btn.addEventListener("click", () => activateTab(btn.dataset.go));
    });
  
    document
      .getElementById("recoverBack")
      .addEventListener("click", () => activateTab("login"));
  
    document
      .getElementById("termsBack")
      .addEventListener("click", () => activateTab("register"));
  
    document.getElementById("termsAccept").addEventListener("click", () => {
      regTerms.checked = true;
      validateRegTerms();
      activateTab("register");
    });
  
    // Индикатор должен пересчитывать позицию при ресайзе (на десктопе
    // ширина табов меняется вместе с шириной карточки).
    window.addEventListener("resize", () => {
      if (!authTabs.hidden) {
        moveTabsIndicator(
          tabLogin.classList.contains("is-active") ? tabLogin : tabRegister
        );
      }
    });
  
    // Выставляем индикатор сразу при загрузке страницы (без анимации перелёта).
    if (tabsIndicator) {
      tabsIndicator.style.transition = "none";
      moveTabsIndicator(tabLogin);
      // возвращаем переход на следующем кадре, чтобы первая отрисовка не "ехала"
      requestAnimationFrame(() => {
        tabsIndicator.style.transition = "";
      });
    }
  
    /* -----------------------------------------------------------------
                 3. Показ/скрытие пароля
              ----------------------------------------------------------------- */
  
    document.querySelectorAll(".field__toggle").forEach((toggleBtn) => {
      const inputId = toggleBtn.dataset.toggleFor;
      const input = document.getElementById(inputId);
      const eyeIcon = toggleBtn.querySelector(".icon--eye");
      const eyeOffIcon = toggleBtn.querySelector(".icon--eye-off");
  
      toggleBtn.addEventListener("click", () => {
        const isHidden = input.type === "password";
        input.type = isHidden ? "text" : "password";
        toggleBtn.setAttribute("aria-pressed", String(isHidden));
        toggleBtn.setAttribute(
          "aria-label",
          isHidden ? "Скрыть пароль" : "Показать пароль"
        );
        eyeIcon.hidden = isHidden;
        eyeOffIcon.hidden = !isHidden;
        input.focus();
      });
    });
  
    /* -----------------------------------------------------------------
                 4. Caps Lock — предупреждение в полях пароля
              ----------------------------------------------------------------- */
  
    function watchCapsLock(input, warningEl) {
      if (!warningEl) return;
  
      function handleKeyEvent(e) {
        if (typeof e.getModifierState !== "function") return;
        const isOn = e.getModifierState("CapsLock");
        warningEl.hidden = !isOn;
      }
  
      input.addEventListener("keydown", handleKeyEvent);
      input.addEventListener("keyup", handleKeyEvent);
      input.addEventListener("blur", () => {
        warningEl.hidden = true;
      });
    }
  
    watchCapsLock(
      document.getElementById("login-password"),
      document.getElementById("login-password-capslock")
    );
    watchCapsLock(
      document.getElementById("reg-password"),
      document.getElementById("reg-password-capslock")
    );
  
    /* -----------------------------------------------------------------
                 5. Форма входа
              ----------------------------------------------------------------- */
  
    const loginForm = document.getElementById("loginForm");
    const loginUsername = document.getElementById("login-username");
    const loginPassword = document.getElementById("login-password");
    const loginStatus = document.getElementById("loginStatus");
    const loginSubmit = document.getElementById("loginSubmit");
  
    // Простая проверка формата почты — без претензий на полное соответствие
    // RFC, но достаточно для отличия "похоже на email" от обычного логина.
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  
    function validateLoginUsername() {
      const el = getErrorEl(loginUsername);
      const value = loginUsername.value.trim();
  
      if (!value) {
        setError(loginUsername, el, "Введите логин или почту.");
        return false;
      }
  
      // Если в значении есть "@" — проверяем его как email,
      // иначе — как обычный логин.
      if (value.includes("@")) {
        if (!EMAIL_RE.test(value)) {
          setError(
            loginUsername,
            el,
            "Введите корректную почту, например name@example.com, или логин без «@»."
          );
          return false;
        }
      } else if (value.length > 64) {
        setError(loginUsername, el, "Логин не должен превышать 64 символа.");
        return false;
      }
  
      setError(loginUsername, el, "");
      return true;
    }
  
    function validateLoginPassword() {
      const el = getErrorEl(loginPassword);
      const value = loginPassword.value;
      if (!value) {
        setError(loginPassword, el, "Введите пароль.");
        return false;
      }
      setError(loginPassword, el, "");
      return true;
    }
  
    loginUsername.addEventListener("blur", validateLoginUsername);
    loginPassword.addEventListener("blur", validateLoginPassword);
    loginUsername.addEventListener("input", () => {
      resetStatus(loginStatus);
      if (loginUsername.classList.contains("is-invalid")) validateLoginUsername();
    });
    loginPassword.addEventListener("input", () => {
      resetStatus(loginStatus);
      if (loginPassword.classList.contains("is-invalid")) validateLoginPassword();
    });
  
    loginForm.addEventListener("submit", (e) => {
      e.preventDefault();
      resetStatus(loginStatus);
  
      const usernameOk = validateLoginUsername();
      const passwordOk = validateLoginPassword();
  
      if (!usernameOk || !passwordOk) {
        const firstInvalid = loginForm.querySelector(".is-invalid");
        if (firstInvalid) firstInvalid.focus();
        showError(loginStatus, "Исправьте ошибки в форме.", loginForm);
        return;
      }
  
      // Выводим данные формы в блок рядом с формой
      const loginFormOutput = document.getElementById("loginFormOutput");
      const loginFormOutputList = document.getElementById("loginFormOutputList");
      const rememberCheckbox = document.getElementById("login-remember");
      const fields = [
        { label: "Логин / почта", value: loginUsername.value.trim() },
        { label: "Пароль", value: "•".repeat(loginPassword.value.length) },
        { label: "Запомнить меня", value: rememberCheckbox.checked ? "Да ✓" : "Нет" },
      ];
      loginFormOutputList.innerHTML = fields
        .map((f) => `<li class="form-output__item">
          <span class="form-output__key">${f.label}:</span>
          <span class="form-output__val">${f.value}</span>
        </li>`)
        .join("");
      loginFormOutput.hidden = false;
  
      setLoading(loginSubmit, true);
      setButtonLabel(loginSubmit, "Проверяем данные...");
      loginStatus.textContent = "";
  
      // Здесь в реальном проекте был бы запрос к серверу.
      setTimeout(() => {
        setLoading(loginSubmit, false);
        restoreButtonLabel(loginSubmit);
        showSuccess(loginStatus, "Вход выполнен успешно.");
      }, FAKE_REQUEST_MS);
    });
  
    /* -----------------------------------------------------------------
                 6. Форма регистрации
              ----------------------------------------------------------------- */
  
    const registerForm = document.getElementById("registerForm");
    const regUsername = document.getElementById("reg-username");
    const regEmail = document.getElementById("reg-email");
    const regPassword = document.getElementById("reg-password");
    const regPassword2 = document.getElementById("reg-password2");
    const regLang = document.getElementById("reg-lang");
    const regTerms = document.getElementById("reg-terms");
    const registerStatus = document.getElementById("registerStatus");
    const registerSubmit = document.getElementById("registerSubmit");
    const strengthBar = document.getElementById("strengthBar");
    const strengthLabel = document.getElementById("strengthLabel");
  
    const ONLY_DIGITS_RE = /^\d+$/;
  
    function validateRegUsername() {
      const el = getErrorEl(regUsername);
      const value = regUsername.value.trim();
  
      if (!value) {
        setError(regUsername, el, "Введите логин.");
        return false;
      }
      if (value.length > 64) {
        setError(regUsername, el, "Логин не должен превышать 64 символа.");
        return false;
      }
      if (ONLY_DIGITS_RE.test(value)) {
        setError(regUsername, el, "Логин не может состоять только из цифр.");
        return false;
      }
      setError(regUsername, el, "");
      return true;
    }
  
    function validateRegEmail() {
      const el = getErrorEl(regEmail);
      const value = regEmail.value.trim();
  
      if (!value) {
        setError(regEmail, el, "Введите адрес электронной почты.");
        return false;
      }
      if (!regEmail.checkValidity()) {
        setError(
          regEmail,
          el,
          "Введите корректный адрес почты, например name@example.com."
        );
        return false;
      }
      setError(regEmail, el, "");
      return true;
    }
  
    // Оценка общей сложности пароля (0–4). Не требует обязательной цифры —
    // просто учитывает длину и разнообразие символов.
    function scorePassword(value) {
      if (!value) return 0;
  
      const length = value.length;
      const hasLower = /[a-z]/.test(value);
      const hasUpper = /[A-Z]/.test(value);
      const hasDigit = /\d/.test(value);
      const hasSymbol = /[^A-Za-z0-9\s]/.test(value);
      const hasUnicodeLetters = /[^\x00-\x7F]/.test(value); // не латиница — тоже учитываем как разнообразие
      const varietyCount = [
        hasLower,
        hasUpper,
        hasDigit,
        hasSymbol || hasUnicodeLetters,
      ].filter(Boolean).length;
  
      let score = 0;
      if (length >= 8) score++;
      if (length >= 12) score++;
      if (length >= 16 && varietyCount >= 2) score++;
      if (varietyCount >= 3) score++;
      if (varietyCount >= 2 && length >= 10) score++;
  
      return Math.min(score, 4);
    }
  
    function updateStrengthIndicator(value) {
      const score = scorePassword(value);
      const percentages = [0, 25, 50, 75, 100];
      const labels = [
        "",
        "Слабый пароль",
        "Средний пароль",
        "Хороший пароль",
        "Надёжный пароль",
      ];
      const colors = [
        "var(--danger)",
        "var(--danger)",
        "var(--warning)",
        "#3f8fd9",
        "var(--success)",
      ];
  
      strengthBar.style.width = percentages[score] + "%";
      strengthBar.style.backgroundColor = colors[score];
      strengthLabel.textContent = value ? labels[score] : "";
    }
  
    function validateRegPassword() {
      const el = getErrorEl(regPassword);
      const value = regPassword.value;
  
      if (!value) {
        setError(regPassword, el, "Введите пароль.");
        return false;
      }
      if (value.length < 8 || value.length > 128) {
        setError(
          regPassword,
          el,
          "Пароль должен содержать от 8 до 128 символов."
        );
        return false;
      }
      if (scorePassword(value) < 1) {
        setError(
          regPassword,
          el,
          "Пароль слишком простой. Сделайте его длиннее или разнообразнее."
        );
        return false;
      }
      setError(regPassword, el, "");
      return true;
    }
  
    function validateRegPassword2() {
      const el = getErrorEl(regPassword2);
      const value = regPassword2.value;
  
      if (!value) {
        setError(regPassword2, el, "Повторите пароль.");
        return false;
      }
      if (value !== regPassword.value) {
        setError(regPassword2, el, "Пароли не совпадают.");
        return false;
      }
      setError(regPassword2, el, "");
      return true;
    }
  
    function validateRegLang() {
      const el = getErrorEl(regLang);
      if (!regLang.value) {
        setError(regLang, el, "Выберите язык интерфейса.");
        return false;
      }
      setError(regLang, el, "");
      return true;
    }
  
    function validateRegTerms() {
      const el = document.getElementById("reg-terms-error");
      if (!regTerms.checked) {
        if (el) el.textContent = "Необходимо принять условия использования.";
        regTerms.setAttribute("aria-invalid", "true");
        return false;
      }
      if (el) el.textContent = "";
      regTerms.removeAttribute("aria-invalid");
      return true;
    }
  
    // События живого ввода / blur
    regUsername.addEventListener("blur", validateRegUsername);
    regUsername.addEventListener("input", () => {
      resetStatus(registerStatus);
      if (regUsername.classList.contains("is-invalid")) validateRegUsername();
    });
  
    regEmail.addEventListener("blur", validateRegEmail);
    regEmail.addEventListener("input", () => {
      resetStatus(registerStatus);
      if (regEmail.classList.contains("is-invalid")) validateRegEmail();
    });
  
    regPassword.addEventListener("input", () => {
      resetStatus(registerStatus);
      updateStrengthIndicator(regPassword.value);
      if (regPassword.classList.contains("is-invalid")) validateRegPassword();
      // Если повтор пароля уже заполнен — перепроверим совпадение
      if (regPassword2.value) validateRegPassword2();
    });
    regPassword.addEventListener("blur", validateRegPassword);
  
    regPassword2.addEventListener("blur", validateRegPassword2);
    regPassword2.addEventListener("input", () => {
      resetStatus(registerStatus);
      if (regPassword2.classList.contains("is-invalid")) validateRegPassword2();
    });
  
    regLang.addEventListener("change", () => {
      resetStatus(registerStatus);
      validateRegLang();
    });
    regTerms.addEventListener("change", () => {
      resetStatus(registerStatus);
      validateRegTerms();
    });
  
    registerForm.addEventListener("submit", (e) => {
      e.preventDefault();
      resetStatus(registerStatus);
  
      const checks = [
        validateRegUsername(),
        validateRegEmail(),
        validateRegPassword(),
        validateRegPassword2(),
        validateRegLang(),
        validateRegTerms(),
      ];
  
      if (checks.includes(false)) {
        const firstInvalid = registerForm.querySelector(
          ".is-invalid, [aria-invalid='true']"
        );
        if (firstInvalid) firstInvalid.focus();
        showError(registerStatus, "Исправьте ошибки в форме.", registerForm);
        return;
      }
  
      setLoading(registerSubmit, true);
      setButtonLabel(registerSubmit, "Проверяем данные...");
  
      // Здесь в реальном проекте был бы запрос к серверу.
      setTimeout(() => {
        setLoading(registerSubmit, false);
        restoreButtonLabel(registerSubmit);
        showSuccess(registerStatus, "Регистрация прошла успешно.");
      }, FAKE_REQUEST_MS);
    });
  
    /* -----------------------------------------------------------------
                 7. Восстановление пароля
              ----------------------------------------------------------------- */
  
    const recoverForm = document.getElementById("recoverForm");
    const recoverEmail = document.getElementById("recover-email");
    const recoverStatus = document.getElementById("recoverStatus");
    const recoverSubmit = document.getElementById("recoverSubmit");
    const recoverEmailField = document.getElementById("recoverEmailField");
    const recoverSubtitle = document.getElementById("recoverSubtitle");
  
    function validateRecoverEmail() {
      const el = getErrorEl(recoverEmail);
      const value = recoverEmail.value.trim();
  
      if (!value) {
        setError(recoverEmail, el, "Введите адрес электронной почты.");
        return false;
      }
      if (!recoverEmail.checkValidity()) {
        setError(
          recoverEmail,
          el,
          "Введите корректный адрес почты, например name@example.com."
        );
        return false;
      }
      setError(recoverEmail, el, "");
      return true;
    }
  
    recoverEmail.addEventListener("blur", validateRecoverEmail);
    recoverEmail.addEventListener("input", () => {
      resetStatus(recoverStatus);
      if (recoverEmail.classList.contains("is-invalid")) validateRecoverEmail();
    });
  
    // Когда снова открываем эту панель — возвращаем её в исходное состояние
    // (на случай, если до этого ссылка уже была "отправлена")
    function resetRecoverPanel() {
      recoverForm.reset();
      recoverEmailField.hidden = false;
      recoverSubmit.hidden = false;
      recoverSubtitle.textContent =
        "Укажите почту, привязанную к аккаунту — мы отправим туда ссылку для сброса пароля";
      resetStatus(recoverStatus);
      setError(recoverEmail, getErrorEl(recoverEmail), "");
    }
  
    document
      .querySelectorAll('[data-go="recover"]')
      .forEach((btn) => btn.addEventListener("click", resetRecoverPanel));
  
    recoverForm.addEventListener("submit", (e) => {
      e.preventDefault();
      resetStatus(recoverStatus);
  
      if (!validateRecoverEmail()) {
        recoverEmail.focus();
        showError(recoverStatus, "Исправьте ошибку в форме.", recoverForm);
        return;
      }
  
      setLoading(recoverSubmit, true);
      setButtonLabel(recoverSubmit, "Отправляем письмо...");
  
      // Здесь в реальном проекте был бы запрос к серверу.
      setTimeout(() => {
        setLoading(recoverSubmit, false);
        restoreButtonLabel(recoverSubmit);
        recoverEmailField.hidden = true;
        recoverSubmit.hidden = true;
        recoverSubtitle.textContent = "";
        showSuccess(
          recoverStatus,
          "Если такой адрес зарегистрирован, мы отправили на него письмо со ссылкой для сброса пароля."
        );
      }, FAKE_REQUEST_MS);
    });
  
    /* -----------------------------------------------------------------
                 8. OAuth-кнопки (заглушки — без реальной интеграции)
              ----------------------------------------------------------------- */
  
    const providerNames = {
      google: "Google",
      github: "GitHub",
      apple: "Apple",
    };
  
    document.querySelectorAll(".btn--oauth").forEach((btn) => {
      btn.addEventListener("click", () => {
        const provider = providerNames[btn.dataset.provider] || "провайдера";
        // Реальной OAuth-интеграции пока нет — это место для будущего backend'а.
        window.alert(
          `Вход через ${provider} ещё не подключён. Здесь будет реальная OAuth-авторизация.`
        );
      });
    });
    /* -----------------------------------------------------------------
               9. Интернационализация (i18n) — переключение языков
            ----------------------------------------------------------------- */
  
    const TRANSLATIONS = {
      ru: {
        pageTitle: "AuraID — Вход и регистрация",
        themeToggleDark: "Включить тёмную тему",
        themeToggleLight: "Включить светлую тему",
        tabLogin: "Вход",
        tabRegister: "Регистрация",
        // --- Форма входа ---
        loginTitle: "Вход в систему",
        loginSubtitle: "Введите данные своей учётной записи",
        loginUsernameLbl: "Логин или почта",
        loginUsernamePh: "login или name@example.com",
        loginPasswordLbl: "Пароль",
        loginForgot: "Забыли пароль?",
        loginShowPwd: "Показать пароль",
        loginHidePwd: "Скрыть пароль",
        loginCapsLock: "⇪ Включён Caps Lock",
        loginRemember: "Запомнить меня",
        loginSubmit: "Войти",
        loginDivider: "или",
        loginOauthGoogle: "Войти через Google",
        loginOauthGithub: "Войти через GitHub",
        loginOauthApple: "Войти через Apple",
        loginNoAccount: "Нет аккаунта?",
        loginNoAccountLink: "Зарегистрируйтесь",
        loginOutputTitle: "Данные формы",
        // --- Форма регистрации ---
        regTitle: "Создать аккаунт",
        regSubtitle: "Это займёт меньше минуты",
        regUsernameLbl: "Логин",
        regUsernameHint: "До 64 символов. Не только цифры.",
        regEmailLbl: "Почта",
        regPasswordLbl: "Пароль",
        regPasswordHint: "8–128 символов. Любые буквы, цифры, символы и пробелы.",
        regShowPwd: "Показать пароль",
        regHidePwd: "Скрыть пароль",
        regCapsLock: "⇪ Включён Caps Lock",
        regPassword2Lbl: "Повтор пароля",
        regLangLbl: "Язык интерфейса",
        regLangPh: "Выберите язык",
        regTermsText: "условиями использования",
        regTermsAgree: "Я согласен с",
        regSubmit: "Зарегистрироваться",
        regDivider: "или",
        regOauthGoogle: "Зарегистрироваться через Google",
        regOauthGithub: "Зарегистрироваться через GitHub",
        regOauthApple: "Зарегистрироваться через Apple",
        regHasAccount: "Уже есть аккаунт?",
        regHasAccountLink: "Войдите",
        // --- Восстановление ---
        recoverBack: "Назад",
        recoverBackAriaLogin: "Назад ко входу",
        recoverTitle: "Восстановление пароля",
        recoverSubtitle: "Укажите почту, привязанную к аккаунту — мы отправим туда ссылку для сброса пароля",
        recoverEmailLbl: "Почта",
        recoverSubmit: "Отправить ссылку",
        recoverRememberPwd: "Вспомнили пароль?",
        recoverRememberLink: "Войдите",
        // --- Условия ---
        termsBack: "Назад",
        termsBackAriaReg: "Назад к регистрации",
        termsTitle: "Условия использования",
        termsP1: "Это демонстрационный учебный проект. Раздел условий использования пока является заглушкой — здесь будет размещён реальный юридический текст перед публикацией сервиса.",
        termsH1: "1. Общие положения",
        termsP2: "Регистрируясь в AuraID, вы соглашаетесь использовать сервис в соответствии с действующим законодательством и не нарушать права других пользователей.",
        termsH2: "2. Обработка данных",
        termsP3: "Логин, почта и пароль используются исключительно для аутентификации. В этой демо-версии данные никуда не передаются и не сохраняются на сервере.",
        termsH3: "3. Изменения условий",
        termsP4: "Условия могут быть обновлены по мере развития проекта. Актуальная версия всегда доступна из формы регистрации.",
        termsAccept: "Принимаю и возвращаюсь",
        // --- Табы announcer ---
        announceLogin: "Открыта форма входа",
        announceRegister: "Открыта форма регистрации",
        announceRecover: "Открыта форма восстановления пароля",
        announceTerms: "Открыты условия использования",
        // --- Сила пароля ---
        strengthWeak: "Слабый пароль",
        strengthFair: "Средний пароль",
        strengthGood: "Хороший пароль",
        strengthStrong: "Надёжный пароль",
        // --- Проверка данных кнопка ---
        loadingCheck: "Проверяем данные...",
        loadingSending: "Отправляем письмо...",
        successLogin: "Вход выполнен успешно.",
        successRegister: "Регистрация прошла успешно.",
        successRecover: "Если такой адрес зарегистрирован, мы отправили на него письмо со ссылкой для сброса пароля.",
      },
  
      en: {
        pageTitle: "AuraID — Sign In & Sign Up",
        themeToggleDark: "Enable dark theme",
        themeToggleLight: "Enable light theme",
        tabLogin: "Sign In",
        tabRegister: "Sign Up",
        loginTitle: "Sign In",
        loginSubtitle: "Enter your account credentials",
        loginUsernameLbl: "Username or email",
        loginUsernamePh: "username or name@example.com",
        loginPasswordLbl: "Password",
        loginForgot: "Forgot password?",
        loginShowPwd: "Show password",
        loginHidePwd: "Hide password",
        loginCapsLock: "⇪ Caps Lock is on",
        loginRemember: "Remember me",
        loginSubmit: "Sign In",
        loginDivider: "or",
        loginOauthGoogle: "Sign in with Google",
        loginOauthGithub: "Sign in with GitHub",
        loginOauthApple: "Sign in with Apple",
        loginNoAccount: "Don't have an account?",
        loginNoAccountLink: "Sign Up",
        loginOutputTitle: "Form data",
        regTitle: "Create account",
        regSubtitle: "Takes less than a minute",
        regUsernameLbl: "Username",
        regUsernameHint: "Up to 64 characters. Not digits only.",
        regEmailLbl: "Email",
        regPasswordLbl: "Password",
        regPasswordHint: "8–128 characters. Any letters, digits, symbols and spaces.",
        regShowPwd: "Show password",
        regHidePwd: "Hide password",
        regCapsLock: "⇪ Caps Lock is on",
        regPassword2Lbl: "Repeat password",
        regLangLbl: "Interface language",
        regLangPh: "Choose a language",
        regTermsText: "terms of use",
        regTermsAgree: "I agree to the",
        regSubmit: "Create Account",
        regDivider: "or",
        regOauthGoogle: "Sign up with Google",
        regOauthGithub: "Sign up with GitHub",
        regOauthApple: "Sign up with Apple",
        regHasAccount: "Already have an account?",
        regHasAccountLink: "Sign In",
        recoverBack: "Back",
        recoverBackAriaLogin: "Back to sign in",
        recoverTitle: "Password Recovery",
        recoverSubtitle: "Enter the email linked to your account and we'll send you a reset link",
        recoverEmailLbl: "Email",
        recoverSubmit: "Send reset link",
        recoverRememberPwd: "Remembered your password?",
        recoverRememberLink: "Sign In",
        termsBack: "Back",
        termsBackAriaReg: "Back to sign up",
        termsTitle: "Terms of Use",
        termsP1: "This is a demo educational project. The terms of use section is currently a placeholder — real legal text will be placed here before the service goes live.",
        termsH1: "1. General Provisions",
        termsP2: "By registering with AuraID, you agree to use the service in accordance with applicable law and not to violate the rights of other users.",
        termsH2: "2. Data Processing",
        termsP3: "Your username, email, and password are used solely for authentication. In this demo version, no data is transmitted or stored on the server.",
        termsH3: "3. Changes to Terms",
        termsP4: "Terms may be updated as the project evolves. The current version is always accessible from the registration form.",
        termsAccept: "Accept & Go Back",
        announceLogin: "Sign in form opened",
        announceRegister: "Sign up form opened",
        announceRecover: "Password recovery form opened",
        announceTerms: "Terms of use opened",
        strengthWeak: "Weak password",
        strengthFair: "Fair password",
        strengthGood: "Good password",
        strengthStrong: "Strong password",
        loadingCheck: "Verifying...",
        loadingSending: "Sending email...",
        successLogin: "Signed in successfully.",
        successRegister: "Account created successfully.",
        successRecover: "If that address is registered, we've sent a reset link to it.",
      },
  
      de: {
        pageTitle: "AuraID — Anmelden & Registrieren",
        themeToggleDark: "Dunkles Design aktivieren",
        themeToggleLight: "Helles Design aktivieren",
        tabLogin: "Anmelden",
        tabRegister: "Registrieren",
        loginTitle: "Anmelden",
        loginSubtitle: "Geben Sie Ihre Kontodaten ein",
        loginUsernameLbl: "Benutzername oder E-Mail",
        loginUsernamePh: "Benutzername oder name@beispiel.de",
        loginPasswordLbl: "Passwort",
        loginForgot: "Passwort vergessen?",
        loginShowPwd: "Passwort anzeigen",
        loginHidePwd: "Passwort verbergen",
        loginCapsLock: "⇪ Feststelltaste ist aktiv",
        loginRemember: "Angemeldet bleiben",
        loginSubmit: "Anmelden",
        loginDivider: "oder",
        loginOauthGoogle: "Mit Google anmelden",
        loginOauthGithub: "Mit GitHub anmelden",
        loginOauthApple: "Mit Apple anmelden",
        loginNoAccount: "Noch kein Konto?",
        loginNoAccountLink: "Registrieren",
        loginOutputTitle: "Formulardaten",
        regTitle: "Konto erstellen",
        regSubtitle: "Dauert weniger als eine Minute",
        regUsernameLbl: "Benutzername",
        regUsernameHint: "Bis zu 64 Zeichen. Nicht nur Ziffern.",
        regEmailLbl: "E-Mail",
        regPasswordLbl: "Passwort",
        regPasswordHint: "8–128 Zeichen. Beliebige Buchstaben, Ziffern, Sonderzeichen und Leerzeichen.",
        regShowPwd: "Passwort anzeigen",
        regHidePwd: "Passwort verbergen",
        regCapsLock: "⇪ Feststelltaste ist aktiv",
        regPassword2Lbl: "Passwort wiederholen",
        regLangLbl: "Oberflächensprache",
        regLangPh: "Sprache wählen",
        regTermsText: "Nutzungsbedingungen",
        regTermsAgree: "Ich stimme den",
        regSubmit: "Konto erstellen",
        regDivider: "oder",
        regOauthGoogle: "Mit Google registrieren",
        regOauthGithub: "Mit GitHub registrieren",
        regOauthApple: "Mit Apple registrieren",
        regHasAccount: "Bereits ein Konto?",
        regHasAccountLink: "Anmelden",
        recoverBack: "Zurück",
        recoverBackAriaLogin: "Zurück zur Anmeldung",
        recoverTitle: "Passwort zurücksetzen",
        recoverSubtitle: "Geben Sie die mit Ihrem Konto verknüpfte E-Mail-Adresse ein — wir senden Ihnen einen Link zum Zurücksetzen des Passworts",
        recoverEmailLbl: "E-Mail",
        recoverSubmit: "Link senden",
        recoverRememberPwd: "Passwort wieder eingefallen?",
        recoverRememberLink: "Anmelden",
        termsBack: "Zurück",
        termsBackAriaReg: "Zurück zur Registrierung",
        termsTitle: "Nutzungsbedingungen",
        termsP1: "Dies ist ein Demonstrations-Lernprojekt. Der Abschnitt zu den Nutzungsbedingungen ist derzeit ein Platzhalter — hier wird vor der Veröffentlichung des Dienstes der echte Rechtstext stehen.",
        termsH1: "1. Allgemeine Bestimmungen",
        termsP2: "Durch die Registrierung bei AuraID stimmen Sie zu, den Dienst im Einklang mit den geltenden Gesetzen zu nutzen und die Rechte anderer Nutzer nicht zu verletzen.",
        termsH2: "2. Datenverarbeitung",
        termsP3: "Benutzername, E-Mail und Passwort werden ausschließlich zur Authentifizierung verwendet. In dieser Demo-Version werden keine Daten übertragen oder auf dem Server gespeichert.",
        termsH3: "3. Änderungen der Bedingungen",
        termsP4: "Die Bedingungen können im Zuge der Projektentwicklung aktualisiert werden. Die aktuelle Version ist stets über das Registrierungsformular zugänglich.",
        termsAccept: "Akzeptieren & Zurück",
        announceLogin: "Anmeldeformular geöffnet",
        announceRegister: "Registrierungsformular geöffnet",
        announceRecover: "Formular zur Passwortwiederherstellung geöffnet",
        announceTerms: "Nutzungsbedingungen geöffnet",
        strengthWeak: "Schwaches Passwort",
        strengthFair: "Mittelmäßiges Passwort",
        strengthGood: "Gutes Passwort",
        strengthStrong: "Starkes Passwort",
        loadingCheck: "Daten werden geprüft...",
        loadingSending: "E-Mail wird gesendet...",
        successLogin: "Erfolgreich angemeldet.",
        successRegister: "Registrierung erfolgreich.",
        successRecover: "Falls diese Adresse registriert ist, haben wir einen Reset-Link gesendet.",
      },
    };
  
    let currentLang = "ru";
  
    // Применяет перевод к DOM-элементам через data-i18n атрибуты
    function applyTranslations(lang) {
      const t = TRANSLATIONS[lang];
      if (!t) return;
      currentLang = lang;
  
      document.title = t.pageTitle;
      document.documentElement.lang = lang;
  
      // --- Header ---
      const themeBtn = document.getElementById("themeToggle");
      const isDark = document.documentElement.getAttribute("data-theme") === "dark";
      themeBtn.setAttribute("aria-label", isDark ? t.themeToggleLight : t.themeToggleDark);
  
      // --- Табы ---
      document.getElementById("tab-login").textContent = t.tabLogin;
      document.getElementById("tab-register").textContent = t.tabRegister;
  
      // --- Форма входа ---
      const loginForm = document.getElementById("loginForm");
      loginForm.querySelector(".form__title").textContent = t.loginTitle;
      loginForm.querySelector(".form__subtitle").textContent = t.loginSubtitle;
      loginForm.querySelector('label[for="login-username"] .field__label, label.field__label[for="login-username"]');
      document.querySelector('label[for="login-username"]').textContent = t.loginUsernameLbl;
      document.getElementById("login-username").placeholder = t.loginUsernamePh;
      document.querySelector('label[for="login-password"]').textContent = t.loginPasswordLbl;
      document.querySelector('[data-go="recover"]').textContent = t.loginForgot;
  
      // Aria-labels кнопок показа пароля
      document.querySelectorAll('[data-toggle-for="login-password"]').forEach(btn => {
        const isPressed = btn.getAttribute("aria-pressed") === "true";
        btn.setAttribute("aria-label", isPressed ? t.loginHidePwd : t.loginShowPwd);
      });
      document.getElementById("login-password-capslock").textContent = t.loginCapsLock;
      document.querySelector(".checkbox__label").textContent = t.loginRemember;
      document.querySelector("#loginSubmit .btn__label").textContent = t.loginSubmit;
      document.querySelector("#loginSubmit .btn__label").dataset.original = t.loginSubmit;
      loginForm.querySelectorAll(".btn--oauth").forEach(btn => {
        const provider = btn.dataset.provider;
        const key = "loginOauth" + provider.charAt(0).toUpperCase() + provider.slice(1);
        const svg = btn.querySelector("svg");
        btn.textContent = "";
        if (svg) btn.appendChild(svg);
        btn.append(" " + (t[key] || btn.textContent));
      });
      const loginDivider = loginForm.querySelector(".divider span");
      if (loginDivider) loginDivider.textContent = t.loginDivider;
      const loginHint = loginForm.querySelector(".form__hint");
      if (loginHint) {
        loginHint.childNodes[0].textContent = t.loginNoAccount + " ";
        loginHint.querySelector("button").textContent = t.loginNoAccountLink;
      }
      const loginOutputTitle = document.querySelector("#loginFormOutput .form-output__title");
      if (loginOutputTitle) loginOutputTitle.textContent = t.loginOutputTitle;
  
      // --- Форма регистрации ---
      const regForm = document.getElementById("registerForm");
      regForm.querySelector(".form__title").textContent = t.regTitle;
      regForm.querySelector(".form__subtitle").textContent = t.regSubtitle;
      document.querySelector('label[for="reg-username"]').textContent = t.regUsernameLbl;
      document.getElementById("reg-username-hint").textContent = t.regUsernameHint;
      document.querySelector('label[for="reg-email"]').textContent = t.regEmailLbl;
      document.querySelector('label[for="reg-password"]').textContent = t.regPasswordLbl;
      document.getElementById("reg-password-hint").textContent = t.regPasswordHint;
      document.querySelectorAll('[data-toggle-for="reg-password"], [data-toggle-for="reg-password2"]').forEach(btn => {
        const isPressed = btn.getAttribute("aria-pressed") === "true";
        btn.setAttribute("aria-label", isPressed ? t.regHidePwd : t.regShowPwd);
      });
      document.getElementById("reg-password-capslock").textContent = t.regCapsLock;
      document.querySelector('label[for="reg-password2"]').textContent = t.regPassword2Lbl;
      document.querySelector('label[for="reg-lang"]').textContent = t.regLangLbl;
      document.querySelector('#reg-lang option[value=""]').textContent = t.regLangPh;
      // Согласие с условиями
      const termsLabel = document.querySelector('label:has(#reg-terms) span');
      if (termsLabel) {
        termsLabel.childNodes[0].textContent = t.regTermsAgree + " ";
        const termsBtn = termsLabel.querySelector("button");
        if (termsBtn) termsBtn.textContent = t.regTermsText;
      }
      document.querySelector("#registerSubmit .btn__label").textContent = t.regSubmit;
      document.querySelector("#registerSubmit .btn__label").dataset.original = t.regSubmit;
      const regDivider = regForm.querySelector(".divider span");
      if (regDivider) regDivider.textContent = t.regDivider;
      regForm.querySelectorAll(".btn--oauth").forEach(btn => {
        const provider = btn.dataset.provider;
        const key = "regOauth" + provider.charAt(0).toUpperCase() + provider.slice(1);
        const svg = btn.querySelector("svg");
        btn.textContent = "";
        if (svg) btn.appendChild(svg);
        btn.append(" " + (t[key] || btn.textContent));
      });
      const regHint = regForm.querySelector(".form__hint");
      if (regHint) {
        regHint.childNodes[0].textContent = t.regHasAccount + " ";
        regHint.querySelector("button").textContent = t.regHasAccountLink;
      }
  
      // --- Восстановление пароля ---
      const recoverBackBtn = document.getElementById("recoverBack");
      recoverBackBtn.setAttribute("aria-label", t.recoverBackAriaLogin);
      recoverBackBtn.childNodes[recoverBackBtn.childNodes.length - 1].textContent = " " + t.recoverBack;
      document.querySelector("#panel-recover .form__title").textContent = t.recoverTitle;
      const recoverSub = document.getElementById("recoverSubtitle");
      if (recoverSub.textContent.trim()) recoverSub.textContent = t.recoverSubtitle;
      document.querySelector('label[for="recover-email"]').textContent = t.recoverEmailLbl;
      document.querySelector("#recoverSubmit .btn__label").textContent = t.recoverSubmit;
      document.querySelector("#recoverSubmit .btn__label").dataset.original = t.recoverSubmit;
      const recoverHint = document.querySelector("#panel-recover .form__hint");
      if (recoverHint) {
        recoverHint.childNodes[0].textContent = t.recoverRememberPwd + " ";
        recoverHint.querySelector("button").textContent = t.recoverRememberLink;
      }
  
      // --- Условия использования ---
      const termsBackBtn = document.getElementById("termsBack");
      termsBackBtn.setAttribute("aria-label", t.termsBackAriaReg);
      termsBackBtn.childNodes[termsBackBtn.childNodes.length - 1].textContent = " " + t.termsBack;
      document.querySelector("#panel-terms .form__title").textContent = t.termsTitle;
      const termsContent = document.querySelector(".terms-content");
      if (termsContent) {
        const ps = termsContent.querySelectorAll("p");
        const hs = termsContent.querySelectorAll("h2");
        if (ps[0]) ps[0].textContent = t.termsP1;
        if (hs[0]) hs[0].textContent = t.termsH1;
        if (ps[1]) ps[1].textContent = t.termsP2;
        if (hs[1]) hs[1].textContent = t.termsH2;
        if (ps[2]) ps[2].textContent = t.termsP3;
        if (hs[2]) hs[2].textContent = t.termsH3;
        if (ps[3]) ps[3].textContent = t.termsP4;
      }
      document.getElementById("termsAccept").textContent = t.termsAccept;
  
      // Обновляем labels силы пароля если они уже выставлены
      const curStrength = strengthLabel.textContent;
      if (curStrength) {
        const allLabels = { ru: TRANSLATIONS.ru, en: TRANSLATIONS.en, de: TRANSLATIONS.de };
        Object.values(allLabels).forEach(lt => {
          if (curStrength === lt.strengthWeak) strengthLabel.textContent = t.strengthWeak;
          if (curStrength === lt.strengthFair) strengthLabel.textContent = t.strengthFair;
          if (curStrength === lt.strengthGood) strengthLabel.textContent = t.strengthGood;
          if (curStrength === lt.strengthStrong) strengthLabel.textContent = t.strengthStrong;
        });
      }
    }
  
    // Переопределяем updateStrengthIndicator чтобы он брал строки из текущего языка
    const _origUpdateStrength = updateStrengthIndicator;
    // eslint-disable-next-line no-global-assign
    updateStrengthIndicator = function(value) {
      const t = TRANSLATIONS[currentLang] || TRANSLATIONS.ru;
      const score = scorePassword(value);
      const percentages = [0, 25, 50, 75, 100];
      const labels = ["", t.strengthWeak, t.strengthFair, t.strengthGood, t.strengthStrong];
      const colors = ["var(--danger)", "var(--danger)", "var(--warning)", "#3f8fd9", "var(--success)"];
      strengthBar.style.width = percentages[score] + "%";
      strengthBar.style.backgroundColor = colors[score];
      strengthLabel.textContent = value ? labels[score] : "";
    };
  
    // Вешаем обработчики на кнопки языков
    document.querySelectorAll(".lang-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const lang = btn.dataset.lang;
        document.querySelectorAll(".lang-btn").forEach(b => {
          b.classList.toggle("is-active", b === btn);
          b.setAttribute("aria-pressed", String(b === btn));
        });
        applyTranslations(lang);
        // Day.js: обновляем локаль часов
        updateClock(lang);
      });
    });
  
    /* -----------------------------------------------------------------
               10. Day.js — живые дата и время в хедере
            ----------------------------------------------------------------- */
  
    const clockEl = document.getElementById("headerClock");
    let clockTimer = null;
  
    const DAYJS_LOCALES = { ru: "ru", en: "en", de: "de" };
  
    function updateClock(lang) {
      if (!window.dayjs) return;
      const locale = DAYJS_LOCALES[lang] || "en";
      dayjs.locale(locale);
      // Формат: «пятница, 13 июня • 14:32:05»
      const formats = {
        ru: "dddd, D MMMM • HH:mm:ss",
        en: "dddd, MMMM D • HH:mm:ss",
        de: "dddd, D. MMMM • HH:mm:ss",
      };
      const fmt = formats[lang] || formats.en;
      clockEl.textContent = dayjs().format(fmt);
    }
  
    function startClock() {
      updateClock(currentLang);
      clockTimer = setInterval(() => updateClock(currentLang), 1000);
    }
  
    startClock();

  })();
