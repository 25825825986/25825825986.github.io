/* 风月酌酒 · 背景音
   白天：雨声；夜里：海浪叠一层篝火。
   音源来自网易云，经站内自建的 /meting/ 取 128k 直链，不下载文件，
   也不碰音乐播放器那条 audio。按钮在右侧工具栏：单击开关，滚轮或方向键调音量。 */
(function () {
  'use strict';

  if (window.__bgNoiseBooted) return;
  window.__bgNoiseBooted = true;

  var VOLUME_KEY = 'bg-noise-volume-v1';
  var BTN_ID = 'bg-noise-toggle';
  /* 主站已迁到 GitHub Pages，动态接口仍在本服务器，必须用绝对地址。
     window.__BLOG_API_BASE__ 由 _config.butterfly.yml 的 inject.head 注入。 */
  var API_BASE = (window.__BLOG_API_BASE__ || '').replace(/\/$/, '');
  var API = API_BASE + '/meting/?server=netease&type=url&level=standard&id=';
  var URL_TTL = 10 * 60 * 1000;
  var CEIL = 0.9;

  var TRACKS = {
    light: [
      { id: '853708', gain: 1, name: '雨声' }
    ],
    dark: [
      { id: '2124487269', gain: 0.62, name: '海浪' },
      { id: '1372573449', gain: 0.4, name: '篝火' }
    ]
  };

  var state = {
    on: false,
    theme: themeOf(),
    volume: loadVolume(),
    ctx: null,
    master: null,
    tracks: { light: [], dark: [] },
    loading: false,
    error: ''
  };

  var btn = null;

  function loadVolume () {
    try {
      var v = parseInt(localStorage.getItem(VOLUME_KEY), 10);
      if (isFinite(v)) return Math.min(100, Math.max(0, v));
    } catch (e) {}
    return 38;
  }

  function saveVolume (v) {
    try { localStorage.setItem(VOLUME_KEY, String(v)); } catch (e) {}
  }

  function themeOf () {
    var root = document.documentElement;
    var dark = root.getAttribute('data-theme') === 'dark' ||
      root.classList.contains('dark') ||
      document.body.classList.contains('dark');
    return dark ? 'dark' : 'light';
  }

  function perceptual (v) {
    return Math.pow(Math.min(100, Math.max(0, v)) / 100, 1.35) * CEIL;
  }

  function allTracks () {
    return state.tracks.light.concat(state.tracks.dark);
  }

  function sceneName (theme) {
    return theme === 'light' ? '雨声' : '海浪与篝火';
  }

  function initContext () {
    if (state.ctx) return true;
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) {
      state.error = '浏览器不支持音频';
      updateUI();
      return false;
    }
    state.ctx = new Ctx();
    state.master = state.ctx.createGain();
    state.master.gain.value = 0;
    state.master.connect(state.ctx.destination);
    return true;
  }

  function makeAudio (theme, spec) {
    var audio = new Audio();
    audio.loop = true;
    audio.preload = 'auto';
    audio.crossOrigin = 'anonymous';
    audio.__theme = theme;
    audio.__spec = spec;
    audio.__gain = null;
    audio.__urlAt = 0;
    audio.addEventListener('error', function () { onAudioError(audio); });
    return audio;
  }

  function connectAudio (audio) {
    if (!state.ctx) return;
    try {
      var source = state.ctx.createMediaElementSource(audio);
      var gain = state.ctx.createGain();
      gain.gain.value = 0;
      source.connect(gain);
      gain.connect(state.master);
      audio.__gain = gain;
    } catch (e) {
      /* 极老的浏览器：退回 element.volume */
      audio.__gain = null;
    }
  }

  function setLevel (audio, value, seconds) {
    var v = Math.max(0, Math.min(1, value));
    if (audio.__gain && state.ctx) {
      var param = audio.__gain.gain;
      var now = state.ctx.currentTime;
      var from = param.value;
      try { param.cancelScheduledValues(now); } catch (e) {}
      param.setValueAtTime(from, now);
      param.linearRampToValueAtTime(v, now + Math.max(0.02, seconds || 0));
    } else {
      audio.volume = v;
    }
  }

  function setMaster (value, seconds) {
    if (!state.master || !state.ctx) return;
    var param = state.master.gain;
    var now = state.ctx.currentTime;
    var from = param.value;
    try { param.cancelScheduledValues(now); } catch (e) {}
    param.setValueAtTime(from, now);
    param.linearRampToValueAtTime(Math.max(0, Math.min(1, value)), now + Math.max(0.02, seconds || 0));
  }

  function fetchUrl (spec) {
    return fetch(API + spec.id + '&r=' + Math.random(), { credentials: 'same-origin' })
      .then(function (res) {
        if (!res.ok) throw new Error('meting ' + res.status);
        return res.json();
      })
      .then(function (list) {
        var url = list && list[0] && list[0].url;
        if (!url) throw new Error('no url');
        return url;
      });
  }

  function ensureTheme (theme) {
    var existing = state.tracks[theme];
    var stale = existing.some(function (audio) {
      return Date.now() - audio.__urlAt > URL_TTL;
    });
    if (existing.length && !stale) return Promise.resolve(existing);

    state.loading = true;
    state.error = '';
    updateUI();

    return Promise.all(TRACKS[theme].map(function (spec) {
      return fetchUrl(spec).then(function (url) {
        var audio = null;
        for (var i = 0; i < existing.length; i++) {
          if (existing[i].__spec.id === spec.id) { audio = existing[i]; break; }
        }
        if (!audio) {
          audio = makeAudio(theme, spec);
          connectAudio(audio);
        }
        audio.src = url;
        audio.__urlAt = Date.now();
        return audio;
      });
    })).then(function (list) {
      state.tracks[theme] = list;
      state.loading = false;
      updateUI();
      return list;
    }).catch(function (err) {
      state.loading = false;
      state.error = '音源加载失败';
      updateUI();
      throw err;
    });
  }

  function playTracks (list) {
    var jobs = list.map(function (audio) {
      if (!audio.paused) return null;
      var p = audio.play();
      return p && p.catch ? p.catch(function (err) { throw err; }) : null;
    });
    return Promise.all(jobs);
  }

  function enable () {
    if (state.loading) return;
    if (!initContext()) return;

    var resumed = state.ctx.state === 'suspended' && state.ctx.resume
      ? state.ctx.resume()
      : Promise.resolve();

    resumed.then(function () {
      return ensureTheme(state.theme);
    }).then(function (list) {
      return playTracks(list).then(function () {
        state.on = true;
        state.error = '';
        setMaster(perceptual(state.volume), 0.6);
        list.forEach(function (audio) {
          setLevel(audio, audio.__spec.gain, 0.9);
        });
        var other = state.theme === 'light' ? 'dark' : 'light';
        state.tracks[other].forEach(function (audio) {
          setLevel(audio, 0, 0.3);
          window.setTimeout(function () {
            if (state.on && state.theme !== other && !audio.paused) audio.pause();
          }, 500);
        });
        updateUI();
      });
    }).catch(function () {
      state.on = false;
      if (!state.error) state.error = '再点一次开始播放';
      updateUI();
    });
  }

  function disable () {
    state.on = false;
    state.error = '';
    setMaster(0, 0.3);
    allTracks().forEach(function (audio) { setLevel(audio, 0, 0.3); });
    window.setTimeout(function () {
      if (state.on) return;
      allTracks().forEach(function (audio) {
        if (!audio.paused) audio.pause();
      });
      if (state.ctx && state.ctx.suspend) state.ctx.suspend();
    }, 450);
    updateUI();
  }

  function applyTheme (force) {
    var next = themeOf();
    if (next === state.theme && !force) return;
    state.theme = next;
    updateUI();
    if (!state.on) return;

    ensureTheme(next).then(function (list) {
      return playTracks(list).then(function () {
        list.forEach(function (audio) {
          setLevel(audio, audio.__spec.gain, 0.8);
        });
        var other = next === 'light' ? 'dark' : 'light';
        state.tracks[other].forEach(function (audio) {
          setLevel(audio, 0, 0.6);
          window.setTimeout(function () {
            if (state.theme !== other && !audio.paused) audio.pause();
          }, 800);
        });
      });
    }).catch(function () {
      state.error = '切换音源失败';
      updateUI();
    });
  }

  function onAudioError (audio) {
    if (!state.on) return;
    var now = Date.now();
    if (now - (audio.__lastRetry || 0) < 10000) return;
    audio.__lastRetry = now;
    fetchUrl(audio.__spec).then(function (url) {
      audio.src = url;
      audio.__urlAt = Date.now();
      if (state.on && audio.__theme === state.theme) {
        var p = audio.play();
        if (p && p.catch) p.catch(function () {});
        setLevel(audio, audio.__spec.gain, 0.6);
      }
    }).catch(function () {});
  }

  function updateUI () {
    if (!btn) return;
    btn.classList.toggle('is-on', state.on);
    btn.classList.toggle('is-loading', state.loading);
    btn.setAttribute('aria-pressed', String(state.on));
    var action = state.on ? '关闭背景音' : '开启背景音';
    btn.setAttribute('aria-label', action);
    var detail;
    if (state.loading) detail = '正在取音源…';
    else if (state.error) detail = state.error;
    else detail = action + ' · ' + sceneName(state.theme) + ' · 音量 ' + state.volume + '%（滚轮 / 方向键调）';
    btn.title = detail;
  }

  function setVolume (value) {
    var v = Math.min(100, Math.max(0, parseInt(value, 10) || 0));
    state.volume = v;
    saveVolume(v);
    if (state.on) setMaster(perceptual(v), 0.2);
    updateUI();
  }

  function setOn (on) {
    if (on) enable();
    else disable();
  }

  function bindButton () {
    btn.addEventListener('click', function () {
      setOn(!state.on);
    });

    btn.addEventListener('wheel', function (e) {
      e.preventDefault();
      var step = e.deltaY < 0 ? 5 : -5;
      setVolume(state.volume + step);
    }, { passive: false });

    btn.addEventListener('keydown', function (e) {
      var step = 0;
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') step = 5;
      else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') step = -5;
      else if (e.key === 'Home') step = -100;
      else if (e.key === 'End') step = 100;
      else return;
      e.preventDefault();
      setVolume(state.volume + step);
    });
  }

  function injectButton () {
    var host = document.getElementById('rightside-config-hide') ||
      document.getElementById('rightside-config-show') ||
      document.getElementById('rightside');
    if (!host) return false;

    btn = document.getElementById(BTN_ID);
    if (!btn) {
      btn = document.createElement('button');
      btn.id = BTN_ID;
      btn.className = 'noise-btn';
      btn.type = 'button';
      btn.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true">' +
        '<path d="M4 9v6M8 6v12M12 3v18M16 6v12M20 9v6"/></svg>';

      /* 放在主题按钮后面，跟「白天 / 夜里」挨着，位置好找。 */
      var dark = document.getElementById('darkmode');
      if (dark && dark.parentNode === host && dark.nextSibling) {
        host.insertBefore(btn, dark.nextSibling);
      } else {
        host.appendChild(btn);
      }
    }

    /* 页面上已经预置了按钮时也要接上事件，只接一次。 */
    if (!btn.__noiseBound) {
      bindButton();
      btn.__noiseBound = true;
    }
    updateUI();
    return true;
  }

  injectButton();
  applyTheme(true);

  var observer = new MutationObserver(function () {
    if (themeOf() === state.theme) return;
    applyTheme(false);
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'class']
  });
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ['class']
  });

  /* pjax 会换掉 rightside 里那两个容器，按钮得重新塞回去。 */
  document.addEventListener('pjax:complete', function () {
    injectButton();
  });

  window.__bgNoise = {
    toggle: function () { setOn(!state.on); },
    setVolume: setVolume,
    state: state
  };
})();
