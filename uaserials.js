/**
 * ============================================================================
 *  Плагін для Лампи — онлайн-джерело UASerials (uaserials.com)
 * ============================================================================
 *
 *  Що робить цей плагін:
 *    1. Додає кнопку "UASerials" на картку фільму/серіалу в Лампі
 *       (одразу після кнопки "Дивитись").
 *    2. За натисканням шукає назву на сайті, показує список результатів.
 *    3. Дістає посилання на відео (m3u8) і віддає його вбудованому плеєру Лампи.
 *
 *  ВАЖЛИВО:
 *    - Реєстрація в Лампі та кнопка на картці — перевірені й працюють.
 *    - Частина ПАРСИНГУ сайту (як читаються результати й відео) може
 *      потребувати підлаштування під поточну верстку сайту — такі місця
 *      позначені:  // >>> НАЛАШТУВАТИ ПІД САЙТ
 *    - Через CORS прямі запити часто блокуються, тому є CORS-проксі (CONFIG.cors).
 *      Якщо нічого не знаходить — спершу перевір проксі.
 *
 *  Версія 1.1.0
 * ============================================================================
 */

(function () {
    'use strict';

    // ------------------------------------------------------------------
    // 1. НАЛАШТУВАННЯ
    // ------------------------------------------------------------------

    var CONFIG = {
        site: 'https://uaserials.com',

        // CORS-проксі (підставляється ПЕРЕД адресою сайту). Пробуй по черзі:
        //   'https://cors.apn.monster/'
        //   'https://api.allorigins.win/raw?url='
        //   '' (порожньо = без проксі)
        cors: 'https://cors.apn.monster/',

        title: 'UASerials',
        component: 'uaserials_online'
    };

    // ------------------------------------------------------------------
    // 2. ДОПОМІЖНІ ФУНКЦІЇ
    // ------------------------------------------------------------------

    function proxied(url) {
        if (!CONFIG.cors) return url;
        if (CONFIG.cors.indexOf('url=') !== -1) return CONFIG.cors + encodeURIComponent(url);
        return CONFIG.cors + url;
    }

    function absolute(href) {
        if (!href) return '';
        if (href.indexOf('http') === 0) return href;
        if (href.indexOf('//') === 0) return 'https:' + href;
        if (href.indexOf('/') === 0) return CONFIG.site + href;
        return CONFIG.site + '/' + href;
    }

    function cleanTitle(str) {
        return (str || '').replace(/[«»"']/g, '').replace(/\s+/g, ' ').trim();
    }

    // ------------------------------------------------------------------
    // 3. РОБОТА ІЗ САЙТОМ  (парсинг)
    // ------------------------------------------------------------------

    var Source = {

        network: new Lampa.Reguest(),

        // --- 3.1 ПОШУК ---
        search: function (query, onDone, onError) {
            var _this = this;
            var url = CONFIG.site + '/index.php?do=search&subaction=search&story=' + encodeURIComponent(query);

            this.network.timeout(15000);
            this.network.native(proxied(url), function (html) {
                try {
                    onDone(_this.parseSearch(html));
                } catch (e) {
                    onError('Помилка обробки пошуку: ' + e.message);
                }
            }, function () {
                onError('Не вдалося отримати результати пошуку (перевір CORS-проксі).');
            });
        },

        // >>> НАЛАШТУВАТИ ПІД САЙТ
        parseSearch: function (html) {
            var doc = $('<div>').html(html);
            var out = [];

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

        // --- 3.2 СТОРІНКА ТАЙТЛА + ВІДЕО ---
        extract: function (pageUrl, onDone, onError) {
            var _this = this;

            this.network.timeout(15000);
            this.network.native(proxied(pageUrl), function (html) {
                try {
                    var iframe = _this.findPlayerIframe(html);
                    if (!iframe) return onError('Не знайдено плеєр на сторінці.');

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

        // >>> НАЛАШТУВАТИ ПІД САЙТ
        findPlayerIframe: function (html) {
            var m = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
            if (m && m[1]) return absolute(m[1]);

            var m2 = html.match(/(https?:\/\/[^"'\\ ]*(ashdi|tortuga|ukrfilms|hdvbstream)[^"'\\ ]*)/i);
            if (m2 && m2[1]) return m2[1];

            return '';
        },

        // >>> НАЛАШТУВАТИ ПІД САЙТ
        parsePlayer: function (html) {
            var streams = [];

            var playlist = html.match(/"file"\s*:\s*"([^"]+\.m3u8[^"]*)"/gi);
            if (playlist && playlist.length) {
                playlist.forEach(function (item, i) {
                    var u = item.match(/"file"\s*:\s*"([^"]+)"/i);
                    if (u && u[1]) {
                        streams.push({ title: 'Серія ' + (i + 1), url: u[1].replace(/\\\//g, '/') });
                    }
                });
            }

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
        var scroll = new Lampa.Scroll({ mask: true, over: true, step: 250 });
        var html = $('<div class="uaserials-list"></div>');
        var last;
        var _this = this;

        this.create = function () {
            return this.render();
        };

        this.render = function () {
            return scroll.render();
        };

        this.start = function () {
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

        this.select = function (item) {
            _this.activity.loader(true);

            Source.extract(item.url, function (streams) {
                _this.activity.loader(false);
                _this.play(item.title, streams);
            }, function (err) {
                _this.activity.loader(false);
                Lampa.Noty.show(err);
            });
        };

        this.play = function (title, streams) {
            var playlist = streams.map(function (s) {
                return { title: s.title || title, url: s.url };
            });

            Lampa.Player.play({ title: title, url: playlist[0].url });
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

        this.pause = function () {};
        this.stop = function () {};
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
        if (e.type !== 'complite' || !e.object || !e.object.activity) return;

        var render = e.object.activity.render();
        if (render.find('.view--uaserials').length) return; // не дублюємо

        var btn = $(
            '<div class="full-start__button selector view--uaserials">' +
                '<svg height="24" viewBox="0 0 24 24" width="24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
                    '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/>' +
                    '<path d="M10 8.5l5 3.5-5 3.5z" fill="currentColor"/>' +
                '</svg>' +
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

        // Ставимо кнопку ДРУГОЮ — одразу після "Дивитись".
        var cont = render.find('.full-start-new__buttons, .full-start__buttons').first();
        if (cont.length && cont.children().length) {
            cont.children().eq(0).after(btn);
        } else if (cont.length) {
            cont.append(btn);
        } else {
            render.find('.full-start__button').first().after(btn);
        }
    }

    function startPlugin() {
        if (window.uaserials_plugin_ready) return;
        window.uaserials_plugin_ready = true;

        Lampa.Component.add(CONFIG.component, Component);
        Lampa.Listener.follow('full', addButton);

        if (Lampa.Manifest && Lampa.Manifest.plugins) {
            Lampa.Manifest.plugins[CONFIG.component] = {
                type: 'video',
                version: '1.1.0',
                name: CONFIG.title,
                description: 'Онлайн-перегляд із ' + CONFIG.site,
                component: CONFIG.component
            };
        }

        console.log('UASerials plugin: запущено');
    }

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
