/**
 * ============================================================================
 *  Плагін для Лампи — онлайн-джерело UASerials (uaserials.com)
 * ============================================================================
 *
 *  Що робить цей плагін:
 *    1. Додає кнопку "UASerials" на картку фільму/серіалу в Лампі.
 *    2. За натисканням шукає назву на сайті, показує список результатів.
 *    3. Дістає посилання на відео (m3u8) і віддає його вбудованому плеєру Лампи.
 *
 *  ВАЖЛИВО (прочитай!):
 *    - Це РОБОЧИЙ КАРКАС. Структура під Лампу вже правильна.
 *      Але "селектори" (те, як саме читаються дані зі сторінок сайту) і
 *      спосіб дістати відео можуть відрізнятися від того, що зараз на сайті,
 *      бо такі сайти часто змінюють верстку і плеєр.
 *    - Місця, які майже напевно доведеться підправити під живий сайт,
 *      позначені коментарем:  // >>> НАЛАШТУВАТИ ПІД САЙТ
 *    - Через обмеження браузера (CORS) прямі запити на сайт часто блокуються.
 *      Тому нижче є CORS_PROXY. Якщо нічого не знаходить — спершу перевір проксі.
 *
 *  Автор каркаса: згенеровано як стартовий шаблон. Версія 1.0.0
 * ============================================================================
 */

(function () {
    'use strict';

    // ------------------------------------------------------------------
    // 1. НАЛАШТУВАННЯ
    // ------------------------------------------------------------------

    var CONFIG = {
        // Головна адреса сайту (без "/" в кінці).
        // Якщо домен зміниться — міняй тут.
        site: 'https://uaserials.com',

        // CORS-проксі. Потрібен, щоб браузер/телевізор міг читати чужий сайт.
        // Проксі підставляється ПЕРЕД адресою сайту.
        // Приклади робочих публічних проксі (пробуй по черзі, якщо не працює):
        //   'https://cors.apn.monster/'
        //   'https://api.allorigins.win/raw?url='
        // Порожній рядок '' = без проксі (працює лише якщо сайт віддає CORS).
        cors: 'https://cors.apn.monster/',

        // Назва, яка показується в інтерфейсі Лампи
        title: 'UASerials',

        // Внутрішній ідентифікатор компонента (унікальний, без пробілів)
        component: 'uaserials_online'
    };

    // ------------------------------------------------------------------
    // 2. ДОПОМІЖНІ ФУНКЦІЇ
    // ------------------------------------------------------------------

    // Обгортає будь-яку адресу в проксі
    function proxied(url) {
        if (!CONFIG.cors) return url;
        // allorigins потребує кодування, інші — ні. Робимо універсально:
        if (CONFIG.cors.indexOf('url=') !== -1) return CONFIG.cors + encodeURIComponent(url);
        return CONFIG.cors + url;
    }

    // Робить абсолютне посилання з відносного (/serial/... -> https://site/serial/...)
    function absolute(href) {
        if (!href) return '';
        if (href.indexOf('http') === 0) return href;
        if (href.indexOf('//') === 0) return 'https:' + href;
        if (href.indexOf('/') === 0) return CONFIG.site + href;
        return CONFIG.site + '/' + href;
    }

    // Прибирає рік/зайве з назви для кращого пошуку
    function cleanTitle(str) {
        return (str || '').replace(/[«»"']/g, '').replace(/\s+/g, ' ').trim();
    }

    // ------------------------------------------------------------------
    // 3. РОБОТА ІЗ САЙТОМ  (найважливіша частина — тут парсинг)
    // ------------------------------------------------------------------
    //
    // Три кроки: пошук -> сторінка тайтла -> витягти відео.
    // Кожен крок — окрема функція, щоб було легко правити.

    var Source = {

        network: new Lampa.Reguest(),

        // --- 3.1 ПОШУК ---------------------------------------------------
        // Повертає масив об'єктів: { title, url, img, info }
        search: function (query, onDone, onError) {
            var _this = this;

            // uaserials працює на движку DLE, стандартний пошук такий:
            var url = CONFIG.site + '/index.php?do=search&subaction=search&story=' + encodeURIComponent(query);

            this.network.timeout(15000);
            this.network.native(proxied(url), function (html) {
                try {
                    var results = _this.parseSearch(html);
                    onDone(results);
                } catch (e) {
                    onError('Помилка обробки пошуку: ' + e.message);
                }
            }, function () {
                onError('Не вдалося отримати результати пошуку (перевір CORS-проксі).');
            });
        },

        // Розбирає HTML сторінки пошуку в список карток.
        // >>> НАЛАШТУВАТИ ПІД САЙТ: селектори класів беруться з реальної верстки.
        parseSearch: function (html) {
            var doc = $('<div>').html(html);
            var out = [];

            // На uaserials картки зазвичай мають клас .short-item / .th-item.
            // Якщо не знаходить — відкрий сторінку пошуку в браузері (F12) і
            // подивись реальний клас блоку результату.
            doc.find('.short-item, .th-item, article').each(function () {
                var el = $(this);
                var link = el.find('a').first().attr('href');
                var title = cleanTitle(el.find('.th-title, .short-title, h2, h3').first().text());
                var img = el.find('img').first().attr('data-src') || el.find('img').first().attr('src');
                var info = el.find('.th-year, .short-year, .misc').first().text();

                if (link && title) {
                    out.push({
                        title: title,
                        url: absolute(link),
                        img: absolute(img),
                        info: cleanTitle(info)
                    });
                }
            });

            return out;
        },

        // --- 3.2 СТОРІНКА ТАЙТЛА + ВІДЕО --------------------------------
        // Відкриває сторінку тайтла і дістає посилання на відео (m3u8).
        // Повертає: { streams: [ {title, url} ] }  — для серіалів кілька серій.
        extract: function (pageUrl, onDone, onError) {
            var _this = this;

            this.network.timeout(15000);
            this.network.native(proxied(pageUrl), function (html) {
                try {
                    var iframe = _this.findPlayerIframe(html);
                    if (!iframe) return onError('Не знайдено плеєр на сторінці.');

                    // Плеєр (ashdi / tortuga) лежить в окремому iframe — читаємо його.
                    _this.network.native(proxied(iframe), function (playerHtml) {
                        try {
                            var streams = _this.parsePlayer(playerHtml);
                            if (!streams.length) return onError('Не знайдено відеопотік у плеєрі.');
                            onDone(streams);
                        } catch (e) {
                            onError('Помилка плеєра: ' + e.message);
                        }
                    }, function () {
                        onError('Не вдалося відкрити плеєр.');
                    });
                } catch (e) {
                    onError('Помилка сторінки: ' + e.message);
                }
            }, function () {
                onError('Не вдалося відкрити сторінку тайтла.');
            });
        },

        // Знаходить адресу iframe плеєра на сторінці тайтла.
        // >>> НАЛАШТУВАТИ ПІД САЙТ
        findPlayerIframe: function (html) {
            // Варіант 1: явний <iframe src="...">
            var m = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
            if (m && m[1]) return absolute(m[1]);

            // Варіант 2: посилання на плеєр у data-атрибуті (ashdi/tortuga)
            var m2 = html.match(/(https?:\/\/[^"'\\ ]*(ashdi|tortuga|ukrfilms|hdvbstream)[^"'\\ ]*)/i);
            if (m2 && m2[1]) return m2[1];

            return '';
        },

        // Дістає прямі посилання на відео з коду плеєра.
        // Плеєри типу ashdi/tortuga містять file:"...m3u8" або playlist JSON.
        // >>> НАЛАШТУВАТИ ПІД САЙТ
        parsePlayer: function (html) {
            var streams = [];

            // 3.2.a — плейлист серіалу: часто масив { title, file } у JS
            // Спробуємо знайти всі m3u8-посилання з підписами.
            var playlist = html.match(/"file"\s*:\s*"([^"]+\.m3u8[^"]*)"/gi);
            if (playlist && playlist.length) {
                playlist.forEach(function (item, i) {
                    var u = item.match(/"file"\s*:\s*"([^"]+)"/i);
                    if (u && u[1]) {
                        streams.push({
                            title: 'Серія ' + (i + 1),
                            url: u[1].replace(/\\\//g, '/')
                        });
                    }
                });
            }

            // 3.2.b — одиночний файл (фільм)
            if (!streams.length) {
                var single = html.match(/file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i)
                          || html.match(/(https?:\/\/[^"'\\ ]+\.m3u8[^"'\\ ]*)/i);
                if (single && single[1]) {
                    streams.push({ title: CONFIG.title, url: single[1].replace(/\\\//g, '/') });
                }
            }

            return streams;
        }
    };

    // ------------------------------------------------------------------
    // 4. КОМПОНЕНТ ЛАМПИ (екран зі списком результатів)
    // ------------------------------------------------------------------

    function Component(object) {
        var scroll  = new Lampa.Scroll({ mask: true, over: true, step: 250 });
        var html    = $('<div class="uaserials-list"></div>');
        var last;                 // останній сфокусований елемент
        var _this   = this;

        // Лампа викликає create() -> render() при відкритті екрана
        this.create = function () {
            return this.render();
        };

        this.render = function () {
            return scroll.render();
        };

        // start() — запускається, коли екран показано
        this.start = function () {
            // Керування пультом/клавіатурою
            Lampa.Controller.add('content', {
                toggle: function () {
                    Lampa.Controller.collectionSet(scroll.render());
                    Lampa.Controller.collectionFocus(last || false, scroll.render());
                },
                up: function () {
                    if (Navigator.canmove('up')) Navigator.move('up');
                    else Lampa.Controller.toggle('head');
                },
                down: function () { Navigator.move('down'); },
                left: function () { Lampa.Controller.toggle('menu'); },
                back: this.back
            });
            Lampa.Controller.toggle('content');

            scroll.body().addClass('torrent-list');
            scroll.append(html);

            this.fetch();
        };

        // Запит пошуку за назвою з картки
        this.fetch = function () {
            var movie = object.movie || {};
            var query = cleanTitle(movie.title || movie.name || movie.original_title || '');

            this.activity.loader(true);

            Source.search(query, function (results) {
                _this.activity.loader(false);
                if (!results.length) {
                    _this.empty('Нічого не знайдено для: ' + query);
                    return;
                }
                _this.draw(results);
            }, function (err) {
                _this.activity.loader(false);
                _this.empty(err);
            });
        };

        // Малює список знайдених тайтлів
        this.draw = function (items) {
            html.empty();

            items.forEach(function (item) {
                var card = $(
                    '<div class="selector uaserials-item" style="display:flex;gap:1em;padding:1em;align-items:center;">' +
                        '<img src="' + (item.img || '') + '" style="width:90px;border-radius:.4em;flex:0 0 auto;" onerror="this.style.opacity=0">' +
                        '<div>' +
                            '<div style="font-size:1.3em;font-weight:600;">' + Lampa.Utils.shortText(item.title, 60) + '</div>' +
                            '<div style="opacity:.6;">' + (item.info || '') + '</div>' +
                        '</div>' +
                    '</div>'
                );

                card.on('hover:focus', function () {
                    last = card[0];
                    scroll.update(card, true);
                });

                card.on('hover:enter', function () {
                    _this.select(item);
                });

                html.append(card);
            });

            Lampa.Controller.enable('content');
        };

        // Вибір тайтла -> дістаємо відео -> запускаємо плеєр
        this.select = function (item) {
            var modal = Lampa.Modal ? null : null;
            _this.activity.loader(true);

            Source.extract(item.url, function (streams) {
                _this.activity.loader(false);

                if (streams.length === 1) {
                    _this.play(item.title, streams);
                } else {
                    // Серіал: показуємо вибір серій прямо у плеєрі як плейлист
                    _this.play(item.title, streams);
                }
            }, function (err) {
                _this.activity.loader(false);
                Lampa.Noty.show(err);
            });
        };

        // Передаємо потік(и) вбудованому плеєру Лампи
        this.play = function (title, streams) {
            var playlist = streams.map(function (s) {
                return { title: s.title || title, url: s.url };
            });

            Lampa.Player.play({
                title: title,
                url: playlist[0].url
            });
            Lampa.Player.playlist(playlist);
        };

        this.empty = function (text) {
            var el = Lampa.Template.get('empty', { message: text || 'Порожньо' });
            html.empty().append(el.render ? el.render() : el);
            Lampa.Controller.enable('content');
        };

        this.back = function () {
            Lampa.Activity.backward();
        };

        // Обов'язкові методи життєвого циклу компонента
        this.pause  = function () {};
        this.stop   = function () {};
        this.destroy = function () {
            Source.network.clear();
            scroll.destroy();
            html.remove();
        };
    }

    // ------------------------------------------------------------------
    // 5. РЕЄСТРАЦІЯ ПЛАГІНА В ЛАМПІ
    // ------------------------------------------------------------------

    function addButton(e) {
        // Додаємо кнопку тільки на екрані повної картки фільму/серіалу
        if (e.type !== 'complite' || !e.object || !e.object.activity) return;

        var render = e.object.activity.render();
        if (render.find('.view--uaserials').length) return; // не дублюємо

        var btn = $(
            '<div class="full-start__button selector view--uaserials">' +
                '<span>' + CONFIG.title + '</span>' +
            '</div>'
        );

        btn.on('hover:enter', function () {
            Lampa.Activity.push({
                url: '',
                title: CONFIG.title + ' — ' + (e.data.movie.title || e.data.movie.name),
                component: CONFIG.component,
                movie: e.data.movie,
                page: 1
            });
        });

        // Ставимо кнопку поряд з іншими кнопками картки
        var target = render.find('.full-start__buttons, .full-start-new__buttons');
        if (target.length) target.append(btn);
        else render.find('.full-start__button').last().after(btn);
    }

    function startPlugin() {
        // Захист від подвійного запуску
        if (window.uaserials_plugin_ready) return;
        window.uaserials_plugin_ready = true;

        // Реєструємо компонент-екран
        Lampa.Component.add(CONFIG.component, Component);

        // Додаємо кнопку на кожну відкриту картку
        Lampa.Listener.follow('full', addButton);

        // Реєстрація в списку плагінів (для відображення в налаштуваннях)
        if (Lampa.Manifest && Lampa.Manifest.plugins) {
            Lampa.Manifest.plugins[CONFIG.component] = {
                type: 'video',
                version: '1.0.0',
                name: CONFIG.title,
                description: 'Онлайн-перегляд із ' + CONFIG.site,
                component: CONFIG.component
            };
        }

        console.log('UASerials plugin: запущено');
    }

    // Лампа може завантажитись пізніше за плагін — чекаємо на неї
    if (window.Lampa && Lampa.Listener) {
        startPlugin();
    } else {
        var wait = setInterval(function () {
            if (window.Lampa && Lampa.Listener) {
                clearInterval(wait);
                startPlugin();
            }
        }, 200);
    }

})();
