import{a as o}from"./chunk-SQE76S5B.js";var a=o((exports,module)=>{(()=>{"use strict";var __webpack_modules__={"./src/index.ts":((__unused_webpack_module,exports,__webpack_require__)=>{eval(`
exports.__esModule = true;
exports.Zuck = void 0;
var utils_1 = __webpack_require__(/*! ./utils */ "./src/utils.ts");
var options_1 = __webpack_require__(/*! ./options */ "./src/options.ts");
var modal_1 = __webpack_require__(/*! ./modal */ "./src/modal.ts");
var Zuck = function (timeline, options) {
    if (!timeline.id) {
        timeline.setAttribute('id', (0, utils_1.generateId)());
    }
    var id = timeline.id;
    var _a = (0, options_1.loadOptions)(options), option = _a.option, callbackOption = _a.callback, templateOption = _a.template, languageOption = _a.language;
    var data = option('stories') || [];
    var internalData = {};
    /* data functions */
    var saveLocalData = function (key, data) {
        try {
            if (option('localStorage') && (0, utils_1.hasWindow)()) {
                var keyName = "zuck-".concat(id, "-").concat(key);
                window.localStorage[keyName] = JSON.stringify(data);
            }
        }
        catch (e) { }
    };
    var getLocalData = function (key) {
        if (option('localStorage') && (0, utils_1.hasWindow)()) {
            var keyName = "zuck-".concat(id, "-").concat(key);
            return window.localStorage[keyName]
                ? JSON.parse(window.localStorage[keyName])
                : undefined;
        }
        else {
            return undefined;
        }
    };
    internalData.seenItems = getLocalData('seenItems') || {};
    var playVideoItem = function (storyViewer, elements, unmute) {
        var itemElement = elements === null || elements === void 0 ? void 0 : elements[1];
        var itemPointer = elements === null || elements === void 0 ? void 0 : elements[0];
        if (!itemElement || !itemPointer) {
            return false;
        }
        var cur = internalData.currentVideoElement;
        if (cur) {
            cur.pause();
        }
        if (itemElement.getAttribute('data-type') === 'video') {
            var video_1 = itemElement.querySelector('video');
            if (!video_1) {
                internalData.currentVideoElement = undefined;
                return false;
            }
            var setDuration = function () {
                var duration = video_1.duration;
                var itemPointerProgress = itemPointer.querySelector('.progress');
                if (+video_1.dataset.length) {
                    duration = +video_1.dataset.length;
                }
                if (duration && itemPointerProgress) {
                    itemPointerProgress.style.animationDuration = "".concat(duration, "s");
                }
            };
            setDuration();
            video_1.addEventListener('loadedmetadata', setDuration);
            internalData.currentVideoElement = video_1;
            video_1.play();
            try {
                unmuteVideoItem(video_1, storyViewer);
            }
            catch (e) {
                console.warn('Could not unmute video', unmute);
            }
        }
        else {
            internalData.currentVideoElement = undefined;
        }
    };
    var findStoryIndex = function (id) {
        return data.findIndex(function (item) { return item.id === id; });
    };
    var pauseVideoItem = function () {
        var video = internalData.currentVideoElement;
        if (video) {
            try {
                video.pause();
            }
            catch (e) { }
        }
    };
    var unmuteVideoItem = function (video, storyViewer) {
        video.muted = false;
        video.volume = 1.0;
        video.removeAttribute('muted');
        video.play();
        if (video.paused) {
            video.muted = true;
            video.play();
        }
        if (storyViewer) {
            storyViewer === null || storyViewer === void 0 ? void 0 : storyViewer.classList.remove('paused');
        }
    };
    var parseItems = function (story, forceUpdate) {
        var storyId = (story === null || story === void 0 ? void 0 : story.getAttribute('data-id')) || '';
        var storyIndex = findStoryIndex(storyId);
        var storyItems = document.querySelectorAll("#".concat(id, " [data-id=\\"").concat(storyId, "\\"] .items > li"));
        var items = [];
        if (!option('reactive') || forceUpdate) {
            storyItems.forEach(function (_a) {
                var firstElementChild = _a.firstElementChild;
                var a = firstElementChild;
                var img = a === null || a === void 0 ? void 0 : a.firstElementChild;
                var li = a === null || a === void 0 ? void 0 : a.parentElement;
                var item = {
                    id: (a === null || a === void 0 ? void 0 : a.getAttribute('data-id')) || (li === null || li === void 0 ? void 0 : li.getAttribute('data-id')),
                    src: a === null || a === void 0 ? void 0 : a.getAttribute('href'),
                    length: (0, utils_1.safeNum)(a === null || a === void 0 ? void 0 : a.getAttribute('data-length')),
                    type: a === null || a === void 0 ? void 0 : a.getAttribute('data-type'),
                    time: (a === null || a === void 0 ? void 0 : a.getAttribute('data-time')) || (li === null || li === void 0 ? void 0 : li.getAttribute('data-time')),
                    link: (a === null || a === void 0 ? void 0 : a.getAttribute('data-link')) || '',
                    linkText: a === null || a === void 0 ? void 0 : a.getAttribute('data-linkText'),
                    preview: img === null || img === void 0 ? void 0 : img.getAttribute('src'),
                    seen: li === null || li === void 0 ? void 0 : li.classList.contains('seen')
                };
                var all = a === null || a === void 0 ? void 0 : a.attributes;
                var reserved = [
                    'data-id',
                    'href',
                    'data-length',
                    'data-type',
                    'data-time',
                    'data-link',
                    'data-linkText'
                ];
                if (all) {
                    for (var z = 0; z < all.length; z++) {
                        if (reserved.indexOf(all[z].nodeName) === -1) {
                            item[all[z].nodeName.replace('data-', '')] = all === null || all === void 0 ? void 0 : all[z].nodeValue;
                        }
                    }
                }
                // destruct the remaining attributes as options
                items.push(item);
            });
            data[storyIndex].items = items;
            var callback = callbackOption('onDataUpdate');
            if (callback) {
                callback(data, function () { });
            }
        }
    };
    var parseStory = function (story) {
        var _a, _b;
        var storyId = (story === null || story === void 0 ? void 0 : story.getAttribute('data-id')) || '';
        var storyIndex = findStoryIndex(storyId);
        var seen = false;
        if (internalData.seenItems[storyId]) {
            seen = true;
        }
        try {
            var storyData = {};
            if (storyIndex !== -1) {
                storyData = data[storyIndex];
            }
            storyData.id = storyId;
            storyData.photo = story === null || story === void 0 ? void 0 : story.getAttribute('data-photo');
            storyData.name = (_a = story === null || story === void 0 ? void 0 : story.querySelector('.name')) === null || _a === void 0 ? void 0 : _a.innerText;
            storyData.link = (_b = story === null || story === void 0 ? void 0 : story.querySelector('.item-link')) === null || _b === void 0 ? void 0 : _b.getAttribute('href');
            storyData.lastUpdated = (0, utils_1.safeNum)((story === null || story === void 0 ? void 0 : story.getAttribute('data-last-updated')) ||
                (story === null || story === void 0 ? void 0 : story.getAttribute('data-time')));
            storyData.seen = seen;
            if (!storyData.items) {
                storyData.items = [];
            }
            if (storyIndex === -1) {
                data.push(storyData);
            }
            else {
                data[storyIndex] = storyData;
            }
        }
        catch (e) {
            data[storyIndex] = {
                items: []
            };
        }
        if (story) {
            story.onclick = function (e) {
                e.preventDefault();
                modal.show(storyId);
            };
        }
        var callback = callbackOption('onDataUpdate');
        if (callback) {
            callback(data, function () { });
        }
    };
    var add = function (data, append) {
        var _a, _b, _c, _d;
        var storyId = data['id'] || '';
        var storyEl = document.querySelector("#".concat(id, " [data-id=\\"").concat(storyId, "\\"]"));
        var items = data['items'];
        var story = null;
        var preview = undefined;
        if (items === null || items === void 0 ? void 0 : items[0]) {
            preview = ((_a = items === null || items === void 0 ? void 0 : items[0]) === null || _a === void 0 ? void 0 : _a.preview) || '';
        }
        if (internalData.seenItems[storyId] === true) {
            data.seen = true;
        }
        if (data) {
            data.currentPreview = preview;
        }
        if (!storyEl) {
            var storyItem = document.createElement('div');
            storyItem.innerHTML = templateOption('timelineItem')(data);
            story = storyItem.firstElementChild;
        }
        else {
            story = storyEl;
        }
        if (data.seen === false) {
            internalData.seenItems[storyId] = false;
            saveLocalData('seenItems', internalData.seenItems);
        }
        story === null || story === void 0 ? void 0 : story.setAttribute('data-id', storyId);
        if (data['photo']) {
            story === null || story === void 0 ? void 0 : story.setAttribute('data-photo', data['photo']);
        }
        story === null || story === void 0 ? void 0 : story.setAttribute('data-time', (_b = data['time']) === null || _b === void 0 ? void 0 : _b.toString());
        if (data['lastUpdated']) {
            story === null || story === void 0 ? void 0 : story.setAttribute('data-last-updated', (_c = data['lastUpdated']) === null || _c === void 0 ? void 0 : _c.toString());
        }
        else {
            story === null || story === void 0 ? void 0 : story.setAttribute('data-last-updated', (_d = data['time']) === null || _d === void 0 ? void 0 : _d.toString());
        }
        parseStory(story);
        if (!storyEl && !option('reactive')) {
            if (append) {
                timeline.appendChild(story);
            }
            else {
                (0, utils_1.prepend)(timeline, story);
            }
        }
        items === null || items === void 0 ? void 0 : items.forEach(function (item) {
            addItem(storyId, item, append);
        });
        if (!append) {
            updateStorySeenPosition();
        }
    };
    var update = add;
    var next = function () {
        modal.next();
    };
    var remove = function (storyId) {
        var _a;
        var story = document.querySelector("#".concat(id, " > [data-id=\\"").concat(storyId, "\\"]"));
        (_a = story === null || story === void 0 ? void 0 : story.parentNode) === null || _a === void 0 ? void 0 : _a.removeChild(story);
    };
    var addItem = function (storyId, data, append) {
        var story = document.querySelector("#".concat(id, " > [data-id=\\"").concat(storyId, "\\"]"));
        if (!option('reactive')) {
            var li = document.createElement('li');
            var el = story === null || story === void 0 ? void 0 : story.querySelectorAll('.items')[0];
            if (data['id']) {
                li.className = data['seen'] ? 'seen' : '';
                li.setAttribute('data-id', data['id']);
            }
            li.innerHTML = templateOption('timelineStoryItem')(data);
            if (append) {
                el === null || el === void 0 ? void 0 : el.appendChild(li);
            }
            else {
                (0, utils_1.prepend)(el, li);
            }
        }
        parseItems(story);
    };
    var removeItem = function (storyId, itemId) {
        var _a;
        var item = document.querySelector("#".concat(id, " > [data-id=\\"").concat(storyId, "\\"] [data-id=\\"").concat(itemId, "\\"]"));
        if (!option('reactive')) {
            (_a = item === null || item === void 0 ? void 0 : item.parentNode) === null || _a === void 0 ? void 0 : _a.removeChild(item);
            data.forEach(function (story) {
                if (story.id === storyId) {
                    story.items = story.items.filter(function (item) { return item.id !== itemId; });
                }
            });
        }
    };
    var nextItem = function (direction, event) {
        var currentStory = internalData.currentStory;
        var currentStoryIndex = findStoryIndex(internalData.currentStory);
        var currentItem = data[currentStoryIndex].currentItem;
        var storyViewer = document.querySelector("#zuck-modal .story-viewer[data-story-id=\\"".concat(currentStory, "\\"]"));
        var directionNumber = direction === 'previous' ? -1 : 1;
        if (!storyViewer) {
            return false;
        }
        var currentItemElements = storyViewer.querySelectorAll("[data-index=\\"".concat(currentItem, "\\"]"));
        var currentPointer = currentItemElements[0];
        var currentItemElement = currentItemElements[1];
        var navigateItem = currentItem + directionNumber;
        var nextItems = storyViewer.querySelectorAll("[data-index=\\"".concat(navigateItem, "\\"]"));
        var nextPointer = nextItems[0];
        var nextItem = nextItems[1];
        if (storyViewer && nextPointer && nextItem) {
            var navigateItemCallback = function () {
                if (direction === 'previous') {
                    currentPointer === null || currentPointer === void 0 ? void 0 : currentPointer.classList.remove('seen');
                    currentItemElement === null || currentItemElement === void 0 ? void 0 : currentItemElement.classList.remove('seen');
                }
                else {
                    currentPointer === null || currentPointer === void 0 ? void 0 : currentPointer.classList.add('seen');
                    currentItemElement === null || currentItemElement === void 0 ? void 0 : currentItemElement.classList.add('seen');
                }
                currentPointer === null || currentPointer === void 0 ? void 0 : currentPointer.classList.remove('active');
                currentItemElement === null || currentItemElement === void 0 ? void 0 : currentItemElement.classList.remove('active');
                nextPointer === null || nextPointer === void 0 ? void 0 : nextPointer.classList.remove('seen');
                nextPointer === null || nextPointer === void 0 ? void 0 : nextPointer.classList.add('active');
                nextItem === null || nextItem === void 0 ? void 0 : nextItem.classList.remove('seen');
                nextItem === null || nextItem === void 0 ? void 0 : nextItem.classList.add('active');
                storyViewer
                    .querySelectorAll('.time')
                    .forEach(function (el) {
                    el.innerText = (0, utils_1.timeAgo)(Number(nextItem.getAttribute('data-time')), option('language'));
                });
                data[currentStoryIndex].currentItem =
                    data[currentStoryIndex].currentItem + directionNumber;
                var nextVideo = nextItem.querySelector('video');
                if (nextVideo) {
                    nextVideo.currentTime = 0;
                }
                playVideoItem(storyViewer, nextItems, event);
            };
            var callback = callbackOption('onNavigateItem');
            callback = !callback
                ? callbackOption('onNextItem')
                : callbackOption('onNavigateItem');
            callback(currentStory, nextItem.getAttribute('data-story-id'), navigateItemCallback);
        }
        else if (storyViewer) {
            if (direction !== 'previous') {
                modal.next();
            }
        }
        return true;
    };
    var navigateItem = nextItem;
    var updateStorySeenPosition = function () {
        document
            .querySelectorAll("#".concat(id, " .story.seen"))
            .forEach(function (el) {
            var storyId = el === null || el === void 0 ? void 0 : el.getAttribute('data-id');
            var storyIndex = findStoryIndex(storyId);
            if (storyId) {
                var newData = data[storyIndex];
                var timeline_1 = el === null || el === void 0 ? void 0 : el.parentNode;
                if (!option('reactive') && timeline_1) {
                    timeline_1.removeChild(el);
                }
                update(newData, true);
            }
        });
    };
    var init = function () {
        if (timeline && timeline.querySelector('.story')) {
            timeline.querySelectorAll('.story').forEach(function (story) {
                parseStory(story);
                parseItems(story);
            });
        }
        if (option('backNative') && (0, utils_1.hasWindow)()) {
            if (window.location.hash === "#!".concat(id)) {
                window.location.hash = '';
            }
            window.addEventListener('popstate', function () {
                if (window.location.hash !== "#!".concat(id)) {
                    window.location.hash = '';
                }
            }, false);
        }
        if (!option('reactive')) {
            var seenItems_1 = getLocalData('seenItems');
            if (seenItems_1) {
                Object.entries(seenItems_1).forEach(function (_a) {
                    var key = _a[1];
                    if (key && data[key]) {
                        data[key].seen = seenItems_1[key] ? true : false;
                    }
                });
            }
        }
        option('stories').forEach(function (item) {
            add(item, true);
        });
        updateStorySeenPosition();
        var avatars = option('avatars') ? 'user-icon' : 'story-preview';
        var list = option('list') ? 'list' : 'carousel';
        var rtl = option('rtl') ? 'rtl' : '';
        timeline.className += " stories ".concat(avatars, " ").concat(list, " ").concat("".concat(option('skin')).toLowerCase(), " ").concat(rtl);
        return {
            id: id,
            option: option,
            callback: callbackOption,
            template: templateOption,
            language: languageOption,
            navigateItem: navigateItem,
            saveLocalData: saveLocalData,
            getLocalData: getLocalData,
            data: data,
            internalData: internalData,
            add: add,
            update: update,
            next: next,
            remove: remove,
            addItem: addItem,
            removeItem: removeItem,
            nextItem: nextItem,
            findStoryIndex: findStoryIndex,
            updateStorySeenPosition: updateStorySeenPosition,
            playVideoItem: playVideoItem,
            pauseVideoItem: pauseVideoItem,
            unmuteVideoItem: unmuteVideoItem
        };
    };
    var zuck = init();
    var modal = (0, modal_1.modal)(zuck);
    return zuck;
};
exports.Zuck = Zuck;
exports["default"] = exports.Zuck;


//# sourceURL=webpack://Zuck/./src/index.ts?`)}),"./src/modal.ts":((__unused_webpack_module,exports,__webpack_require__)=>{eval(`
exports.__esModule = true;
exports.modal = void 0;
var utils_1 = __webpack_require__(/*! ./utils */ "./src/utils.ts");
var modal = function (zuck) {
    var id = zuck.id;
    var modalZuckContainer = document.querySelector('#zuck-modal');
    if (!modalZuckContainer && !zuck.hasModal) {
        zuck.hasModal = true;
        modalZuckContainer = document.createElement('div');
        modalZuckContainer.id = 'zuck-modal';
        if (zuck.option('cubeEffect')) {
            modalZuckContainer.className = 'with-cube';
        }
        modalZuckContainer.innerHTML = '<div id="zuck-modal-content"></div>';
        modalZuckContainer.style.display = 'none';
        modalZuckContainer.setAttribute('tabIndex', '1');
        modalZuckContainer.onkeyup = function (_a) {
            var keyCode = _a.keyCode;
            var code = keyCode;
            if (code === 27) {
                modalZuckContainer.modal.close();
            }
            else if (code === 13 || code === 32) {
                modalZuckContainer.modal.next();
            }
        };
        if (zuck.option('openEffect')) {
            modalZuckContainer === null || modalZuckContainer === void 0 ? void 0 : modalZuckContainer.classList.add('with-effects');
        }
        if (zuck.option('rtl')) {
            modalZuckContainer === null || modalZuckContainer === void 0 ? void 0 : modalZuckContainer.classList.add('rtl');
        }
        (0, utils_1.onTransitionEnd)(modalZuckContainer, function () {
            var modalContent = document.querySelector('#zuck-modal-content');
            if (modalZuckContainer === null || modalZuckContainer === void 0 ? void 0 : modalZuckContainer.classList.contains('closed')) {
                if (modalContent) {
                    modalContent.innerHTML = '';
                }
                modalZuckContainer.style.display = 'none';
                modalZuckContainer.classList.remove('closed');
                modalZuckContainer.classList.remove('animated');
            }
        });
        document.body.appendChild(modalZuckContainer);
    }
    var translate = function (element, to, duration, ease) {
        var _a;
        if (to === undefined || (to && isNaN(to))) {
            return;
        }
        var direction = to > 0 ? 1 : -1;
        var modalWidth = ((_a = document.querySelector('#zuck-modal')) === null || _a === void 0 ? void 0 : _a.offsetWidth) || 1;
        var to3d = (Math.abs(to) / modalWidth) * 90 * direction;
        if (zuck.option('cubeEffect')) {
            var scaling = to3d === 0 ? 'scale(0.95)' : 'scale(0.930,0.930)';
            var modalContent = document.querySelector('#zuck-modal-content');
            if (modalContent) {
                modalContent.style.transform = scaling;
            }
            if (to3d < -90 || to3d > 90) {
                return false;
            }
        }
        var transform = !zuck.option('cubeEffect')
            ? "translate3d(".concat(to, "px, 0, 0)")
            : "rotateY(".concat(to3d, "deg)");
        if (element) {
            if (ease) {
                element.style.transitionTimingFunction = ease;
            }
            element.style.transitionDuration = "".concat(duration, "ms");
            element.style.transform = transform;
        }
    };
    var fullScreen = function (elem, cancel) {
        var anyDocument = document;
        var anyElem = elem;
        try {
            if (cancel) {
                if (anyDocument.fullscreenElement ||
                    anyDocument.webkitFullscreenElement ||
                    anyDocument.mozFullScreenElement ||
                    anyDocument.msFullscreenElement) {
                    if (anyDocument.exitFullscreen) {
                        anyDocument.exitFullscreen()["catch"](function () { });
                    }
                    else if (anyDocument.mozCancelFullScreen) {
                        anyDocument.mozCancelFullScreen()["catch"](function () { });
                    }
                }
            }
            else {
                if (anyElem.requestFullscreen) {
                    anyElem.requestFullscreen();
                }
                else if (anyElem.msRequestFullscreen) {
                    anyElem.msRequestFullscreen();
                }
                else if (anyElem.mozRequestFullScreen) {
                    anyElem.mozRequestFullScreen();
                }
                else if (anyElem.webkitRequestFullscreen) {
                    anyElem.webkitRequestFullscreen();
                }
            }
        }
        catch (e) {
            console.warn("[Zuck.js] Can't access fullscreen");
        }
    };
    var moveStoryItem = function (direction) {
        var modalContainer = document.querySelector('#zuck-modal');
        var modalSlider = document.querySelector("#zuck-modal-slider-".concat(id));
        var target = '';
        var useless = '';
        var transform = 0;
        var slideItems = {
            previous: document.querySelector('#zuck-modal .story-viewer.previous'),
            next: document.querySelector('#zuck-modal .story-viewer.next'),
            viewing: document.querySelector('#zuck-modal .story-viewer.viewing')
        };
        if ((!slideItems.previous && !direction) ||
            (!slideItems.next && direction)) {
            if (!zuck.option('rtl')) {
                return false;
            }
        }
        if (!direction) {
            target = 'previous';
            useless = 'next';
        }
        else {
            target = 'next';
            useless = 'previous';
        }
        var transitionTime = 600;
        if (zuck.option('cubeEffect')) {
            if (target === 'previous') {
                transform = (0, utils_1.safeNum)(modalContainer === null || modalContainer === void 0 ? void 0 : modalContainer.slideWidth);
            }
            else if (target === 'next') {
                transform = (0, utils_1.safeNum)(modalContainer === null || modalContainer === void 0 ? void 0 : modalContainer.slideWidth) * -1;
            }
        }
        else {
            transform = (0, utils_1.findPos)(slideItems[target])[0] * -1;
        }
        translate(modalSlider, transform, transitionTime, null);
        setTimeout(function () {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
            // set page data when transition complete
            if (zuck.option('rtl')) {
                var tmp = target;
                target = useless;
                useless = tmp;
            }
            if (target !== '' && slideItems[target] && useless !== '') {
                var currentStory = (_a = slideItems[target]) === null || _a === void 0 ? void 0 : _a.getAttribute('data-story-id');
                zuck.internalData.currentStory = currentStory;
                var oldStory = document.querySelector("#zuck-modal .story-viewer.".concat(useless));
                if (oldStory) {
                    (_b = oldStory === null || oldStory === void 0 ? void 0 : oldStory.parentNode) === null || _b === void 0 ? void 0 : _b.removeChild(oldStory);
                }
                if (slideItems.viewing) {
                    (_c = slideItems.viewing) === null || _c === void 0 ? void 0 : _c.classList.add('stopped');
                    (_d = slideItems.viewing) === null || _d === void 0 ? void 0 : _d.classList.add(useless);
                    (_e = slideItems.viewing) === null || _e === void 0 ? void 0 : _e.classList.remove('viewing');
                }
                if (slideItems[target]) {
                    (_f = slideItems[target]) === null || _f === void 0 ? void 0 : _f.classList.remove('stopped');
                    (_g = slideItems[target]) === null || _g === void 0 ? void 0 : _g.classList.remove(target);
                    (_h = slideItems[target]) === null || _h === void 0 ? void 0 : _h.classList.add('viewing');
                }
                var newTimelineItem = getStoryMorningGlory(target);
                if (newTimelineItem) {
                    createStoryViewer(newTimelineItem, target);
                }
                var storyId = zuck.internalData.currentStory;
                var storyIndex = zuck.findStoryIndex(storyId);
                var storyWrap = document.querySelector("#zuck-modal [data-story-id=\\"".concat(storyId, "\\"]"));
                var items = undefined;
                if (storyWrap) {
                    items = storyWrap.querySelectorAll('[data-index].active');
                    var duration = (_j = items === null || items === void 0 ? void 0 : items[0]) === null || _j === void 0 ? void 0 : _j.firstElementChild;
                    zuck.data[storyIndex].currentItem = (0, utils_1.safeNum)((_k = items === null || items === void 0 ? void 0 : items[0]) === null || _k === void 0 ? void 0 : _k.getAttribute('data-index'));
                    if (items === null || items === void 0 ? void 0 : items[0]) {
                        items[0].innerHTML = zuck.template('viewerItemPointerProgress')(duration.style.cssText);
                        (0, utils_1.onAnimationEnd)(duration, function () {
                            zuck.nextItem();
                        });
                    }
                }
                translate(modalSlider, 0, 0, null);
                if (items) {
                    var storyViewer = document.querySelector("#zuck-modal .story-viewer[data-story-id=\\"".concat(currentStory, "\\"]"));
                    zuck.playVideoItem(storyViewer, items);
                }
                zuck.callback('onView')(zuck.internalData.currentStory);
            }
        }, transitionTime + 50);
    };
    var createStoryViewer = function (storyData, className, forcePlay) {
        var modalSlider = document.querySelector("#zuck-modal-slider-".concat(id));
        var storyItems = storyData['items'];
        storyData.time = storyItems && (storyItems === null || storyItems === void 0 ? void 0 : storyItems[0]['time']);
        var htmlItems = '';
        var pointerItems = '';
        var storyId = storyData['id'];
        var slides = document.createElement('div');
        var currentItem = storyData['currentItem'] || 0;
        var exists = document.querySelector("#zuck-modal .story-viewer[data-story-id=\\"".concat(storyId, "\\"]"));
        if (exists) {
            return false;
        }
        slides.className = 'slides';
        storyItems.forEach(function (item, i) {
            if (currentItem > i) {
                storyData.items[i].seen = true;
                item.seen = true;
            }
            pointerItems += zuck.template('viewerItemPointer')(i, currentItem, item);
            htmlItems += zuck.template('viewerItemBody')(i, currentItem, item);
        });
        slides.innerHTML = htmlItems;
        var video = slides.querySelector('video');
        var addMuted = function (video) {
            if (video.muted) {
                storyViewer === null || storyViewer === void 0 ? void 0 : storyViewer.classList.add('muted');
            }
            else {
                storyViewer === null || storyViewer === void 0 ? void 0 : storyViewer.classList.remove('muted');
            }
        };
        if (video) {
            video.onwaiting = function () {
                if (video.paused) {
                    storyViewer === null || storyViewer === void 0 ? void 0 : storyViewer.classList.add('paused');
                    storyViewer === null || storyViewer === void 0 ? void 0 : storyViewer.classList.add('loading');
                }
            };
            video.onplay = function () {
                addMuted(video);
                storyViewer === null || storyViewer === void 0 ? void 0 : storyViewer.classList.remove('stopped');
                storyViewer === null || storyViewer === void 0 ? void 0 : storyViewer.classList.remove('paused');
                storyViewer === null || storyViewer === void 0 ? void 0 : storyViewer.classList.remove('loading');
            };
            video.onload =
                video.onplaying =
                    video.oncanplay =
                        function () {
                            addMuted(video);
                            storyViewer === null || storyViewer === void 0 ? void 0 : storyViewer.classList.remove('loading');
                        };
            video.onvolumechange = function () {
                addMuted(video);
            };
        }
        var storyViewerWrap = document.createElement('div');
        storyViewerWrap.innerHTML = zuck.template('viewerItem')(storyData, storyItems[currentItem]);
        var storyViewer = storyViewerWrap.firstElementChild;
        var storyViewerPointerWrap = storyViewer.querySelector('.slides-pointers .wrap');
        storyViewer.className = "story-viewer muted ".concat(className, " ").concat(!forcePlay ? 'stopped' : '', " ").concat(zuck.option('backButton') ? 'with-back-button' : '');
        if (storyId) {
            storyViewer.setAttribute('data-story-id', storyId);
        }
        if (storyViewerPointerWrap) {
            storyViewerPointerWrap.innerHTML = pointerItems;
        }
        storyViewer
            .querySelectorAll('.close, .back')
            .forEach(function (el) {
            el.onclick = function (e) {
                e.preventDefault();
                modalZuckContainer.modal.close();
            };
        });
        storyViewer.appendChild(slides);
        if (className === 'viewing') {
            zuck.playVideoItem(storyViewer, storyViewer.querySelectorAll("[data-index=\\"".concat(currentItem, "\\"].active")), undefined);
        }
        storyViewer
            .querySelectorAll('.slides-pointers [data-index] > .progress')
            .forEach(function (el) {
            (0, utils_1.onAnimationEnd)(el, function () {
                zuck.nextItem(undefined);
            });
        });
        if (!modalSlider) {
            return;
        }
        if (className === 'previous') {
            (0, utils_1.prepend)(modalSlider, storyViewer);
        }
        else {
            modalSlider.appendChild(storyViewer);
        }
    };
    var createStoryTouchEvents = function (modalSlider) {
        var modalContainer = document.querySelector('#zuck-modal');
        var enableMouseEvents = true;
        var position = null;
        var touchOffset = null;
        var isScrolling = null;
        var delta = null;
        var timer = undefined;
        var nextTimer = undefined;
        var touchStart = function (event) {
            var storyViewer = document.querySelector('#zuck-modal .viewing');
            var storyViewerWrap = document.querySelector('#zuck-modal .story-viewer');
            if (event.target.nodeName === 'A') {
                return;
            }
            var touches = event.touches
                ? event.touches[0]
                : event;
            var pos = (0, utils_1.findPos)(document.querySelector('#zuck-modal .story-viewer.viewing'));
            if (modalContainer) {
                modalContainer.slideWidth = storyViewerWrap === null || storyViewerWrap === void 0 ? void 0 : storyViewerWrap.offsetWidth;
                modalContainer.slideHeight = storyViewerWrap === null || storyViewerWrap === void 0 ? void 0 : storyViewerWrap.offsetHeight;
            }
            position = {
                x: pos[0],
                y: pos[1]
            };
            var clientX = touches.clientX;
            var clientY = touches.clientY;
            touchOffset = {
                x: clientX,
                y: clientY,
                time: Date.now(),
                valid: true
            };
            if (clientY < 80 || clientY > (0, utils_1.safeNum)(modalContainer === null || modalContainer === void 0 ? void 0 : modalContainer.slideHeight) - 80) {
                touchOffset.valid = false;
            }
            else {
                event.preventDefault();
                isScrolling = undefined;
                delta = {};
                if (enableMouseEvents) {
                    modalSlider === null || modalSlider === void 0 ? void 0 : modalSlider.addEventListener('mousemove', touchMove);
                    modalSlider === null || modalSlider === void 0 ? void 0 : modalSlider.addEventListener('mouseup', touchEnd);
                    modalSlider === null || modalSlider === void 0 ? void 0 : modalSlider.addEventListener('mouseleave', touchEnd);
                }
                modalSlider === null || modalSlider === void 0 ? void 0 : modalSlider.addEventListener('touchmove', touchMove);
                modalSlider === null || modalSlider === void 0 ? void 0 : modalSlider.addEventListener('touchend', touchEnd);
                if (storyViewer) {
                    storyViewer === null || storyViewer === void 0 ? void 0 : storyViewer.classList.add('paused');
                }
                zuck.pauseVideoItem();
                timer = setTimeout(function () {
                    if (storyViewer) {
                        storyViewer === null || storyViewer === void 0 ? void 0 : storyViewer.classList.add('longPress');
                    }
                }, 600);
                nextTimer = setTimeout(function () {
                    clearInterval(nextTimer);
                    nextTimer = undefined;
                }, 250);
            }
        };
        var touchMove = function (event) {
            var touches = event.touches
                ? event.touches[0]
                : event;
            var clientX = touches.clientX;
            var clientY = touches.clientY;
            if (touchOffset && touchOffset.valid) {
                delta = {
                    x: clientX - touchOffset.x,
                    y: clientY - touchOffset.y
                };
                if (typeof isScrolling === 'undefined') {
                    isScrolling = !!(isScrolling || Math.abs(delta.x) < Math.abs(delta.y));
                }
                if (!isScrolling && touchOffset) {
                    event.preventDefault();
                    translate(modalSlider, (0, utils_1.safeNum)(position === null || position === void 0 ? void 0 : position.x) + (0, utils_1.safeNum)(delta === null || delta === void 0 ? void 0 : delta.x), 0, null);
                }
            }
        };
        var touchEnd = function (event) {
            var storyViewer = document.querySelector('#zuck-modal .viewing');
            var lastTouchOffset = touchOffset;
            var duration = touchOffset ? Date.now() - touchOffset.time : undefined;
            var isValid = (Number(duration) < 300 && Math.abs((0, utils_1.safeNum)(delta === null || delta === void 0 ? void 0 : delta.x)) > 25) ||
                Math.abs((0, utils_1.safeNum)(delta === null || delta === void 0 ? void 0 : delta.x)) > (0, utils_1.safeNum)(modalContainer === null || modalContainer === void 0 ? void 0 : modalContainer.slideWidth) / 3;
            var direction = (0, utils_1.safeNum)(delta === null || delta === void 0 ? void 0 : delta.x) < 0;
            var index = direction
                ? document.querySelector('#zuck-modal .story-viewer.next')
                : document.querySelector('#zuck-modal .story-viewer.previous');
            var isOutOfBounds = (direction && !index) || (!direction && !index);
            if (touchOffset && !touchOffset.valid) {
            }
            else {
                if (delta) {
                    if (!isScrolling) {
                        if (isValid && !isOutOfBounds) {
                            moveStoryItem(direction);
                        }
                        else {
                            translate(modalSlider, (0, utils_1.safeNum)(position === null || position === void 0 ? void 0 : position.x), 300);
                        }
                    }
                    touchOffset = undefined;
                    if (enableMouseEvents) {
                        modalSlider === null || modalSlider === void 0 ? void 0 : modalSlider.removeEventListener('mousemove', touchMove);
                        modalSlider === null || modalSlider === void 0 ? void 0 : modalSlider.removeEventListener('mouseup', touchEnd);
                        modalSlider === null || modalSlider === void 0 ? void 0 : modalSlider.removeEventListener('mouseleave', touchEnd);
                    }
                    modalSlider === null || modalSlider === void 0 ? void 0 : modalSlider.removeEventListener('touchmove', touchMove);
                    modalSlider === null || modalSlider === void 0 ? void 0 : modalSlider.removeEventListener('touchend', touchEnd);
                }
                var video = zuck.internalData.currentVideoElement;
                if (timer) {
                    clearInterval(timer);
                }
                if (storyViewer) {
                    zuck.playVideoItem(storyViewer, storyViewer.querySelectorAll('.active'), undefined);
                    storyViewer === null || storyViewer === void 0 ? void 0 : storyViewer.classList.remove('longPress');
                    storyViewer === null || storyViewer === void 0 ? void 0 : storyViewer.classList.remove('paused');
                }
                if (nextTimer) {
                    clearInterval(nextTimer);
                    nextTimer = undefined;
                    var navigateItem = function () {
                        if (!direction) {
                            if ((0, utils_1.safeNum)(lastTouchOffset === null || lastTouchOffset === void 0 ? void 0 : lastTouchOffset.x) > document.body.offsetWidth / 3 ||
                                !zuck.option('previousTap')) {
                                if (zuck.option('rtl')) {
                                    zuck.navigateItem('previous', event);
                                }
                                else {
                                    zuck.navigateItem('next', event);
                                }
                            }
                            else {
                                if (zuck.option('rtl')) {
                                    zuck.navigateItem('next', event);
                                }
                                else {
                                    zuck.navigateItem('previous', event);
                                }
                            }
                        }
                    };
                    var storyViewerViewing = document.querySelector('#zuck-modal .viewing');
                    if (storyViewerViewing && video) {
                        if (storyViewerViewing === null || storyViewerViewing === void 0 ? void 0 : storyViewerViewing.classList.contains('muted')) {
                            zuck.unmuteVideoItem(video, storyViewerViewing);
                        }
                        else {
                            navigateItem();
                        }
                    }
                    else {
                        navigateItem();
                        return false;
                    }
                }
            }
        };
        modalSlider === null || modalSlider === void 0 ? void 0 : modalSlider.addEventListener('touchstart', touchStart);
        if (enableMouseEvents) {
            modalSlider === null || modalSlider === void 0 ? void 0 : modalSlider.addEventListener('mousedown', touchStart);
        }
    };
    var getStoryMorningGlory = function (what) {
        // my wife told me to stop singing Wonderwall. I SAID MAYBE.
        var currentStory = zuck.internalData.currentStory;
        if (currentStory && what !== '') {
            var element = document.querySelector("#".concat(id, " [data-id=\\"").concat(currentStory, "\\"]"));
            var foundStory = what === 'previous'
                ? element.previousElementSibling
                : element.nextElementSibling;
            if (foundStory) {
                var storyId = foundStory.getAttribute('data-id');
                var storyIndex = zuck.findStoryIndex(storyId);
                var data = zuck.data[storyIndex] || false;
                return data;
            }
        }
        return false;
    };
    var show = function (storyId) {
        var modalContainer = document.querySelector('#zuck-modal');
        var callback = function () {
            var modalContent = document.querySelector('#zuck-modal-content');
            modalContent.innerHTML = "<div id=\\"zuck-modal-slider-".concat(id, "\\" class=\\"slider\\"></div>");
            if (!modalContent || !storyId) {
                return;
            }
            var storyIndex = zuck.findStoryIndex(storyId);
            var storyData = zuck.data[storyIndex];
            var currentItem = storyData.currentItem || 0;
            var modalSlider = document.querySelector("#zuck-modal-slider-".concat(id));
            createStoryTouchEvents(modalSlider);
            zuck.internalData.currentStory = storyId;
            storyData.currentItem = currentItem;
            if (zuck.option('backNative') && (0, utils_1.hasWindow)()) {
                window.location.hash = "#!".concat(id);
            }
            var previousItemData = getStoryMorningGlory('previous');
            if (previousItemData) {
                createStoryViewer(previousItemData, 'previous');
            }
            createStoryViewer(storyData, 'viewing', true);
            var nextItemData = getStoryMorningGlory('next');
            if (nextItemData) {
                createStoryViewer(nextItemData, 'next');
            }
            if (zuck.option('autoFullScreen')) {
                modalContainer === null || modalContainer === void 0 ? void 0 : modalContainer.classList.add('fullscreen');
            }
            var tryFullScreen = function () {
                if ((modalContainer === null || modalContainer === void 0 ? void 0 : modalContainer.classList.contains('fullscreen')) &&
                    zuck.option('autoFullScreen') &&
                    document.body.offsetWidth <= 1024) {
                    fullScreen(modalContainer);
                }
                modalContainer === null || modalContainer === void 0 ? void 0 : modalContainer.focus();
            };
            var storyViewerWrap = document.querySelector('#zuck-modal .story-viewer');
            if (zuck.option('openEffect') && modalContainer) {
                var storyEl = document.querySelector("#".concat(id, " [data-id=\\"").concat(storyId, "\\"] .item-preview"));
                var pos = (0, utils_1.findPos)(storyEl);
                modalContainer.style.marginLeft = "".concat(pos[0] + (0, utils_1.safeNum)(storyEl === null || storyEl === void 0 ? void 0 : storyEl.offsetWidth) / 2, "px");
                modalContainer.style.marginTop = "".concat(pos[1] + (0, utils_1.safeNum)(storyEl === null || storyEl === void 0 ? void 0 : storyEl.offsetHeight) / 2, "px");
                modalContainer.style.display = 'block';
                modalContainer.slideWidth = (storyViewerWrap === null || storyViewerWrap === void 0 ? void 0 : storyViewerWrap.offsetWidth) || 0;
                setTimeout(function () {
                    modalContainer === null || modalContainer === void 0 ? void 0 : modalContainer.classList.add('animated');
                }, 10);
                setTimeout(function () {
                    tryFullScreen();
                }, 300); // because effects
            }
            else {
                if (modalContainer) {
                    modalContainer.style.display = 'block';
                    modalContainer.slideWidth = (storyViewerWrap === null || storyViewerWrap === void 0 ? void 0 : storyViewerWrap.offsetWidth) || 0;
                }
                tryFullScreen();
            }
            zuck.callback('onView')(storyId);
        };
        zuck.callback('onOpen')(storyId, callback);
    };
    var next = function () {
        var callback = function () {
            var lastStory = zuck.internalData.currentStory;
            var lastStoryIndex = zuck.findStoryIndex(lastStory);
            var lastStoryTimelineElement = document.querySelector("#".concat(id, " [data-id=\\"").concat(lastStory, "\\"]"));
            if (lastStoryTimelineElement) {
                lastStoryTimelineElement === null || lastStoryTimelineElement === void 0 ? void 0 : lastStoryTimelineElement.classList.add('seen');
                zuck.data[lastStoryIndex].seen = true;
                zuck.internalData.seenItems[lastStory] = true;
                zuck.saveLocalData('seenItems', zuck.internalData.seenItems);
                zuck.updateStorySeenPosition();
            }
            var stories = document.querySelector('#zuck-modal .story-viewer.next');
            if (!stories) {
                modalZuckContainer.modal.close();
            }
            else {
                if (zuck.option('rtl')) {
                    moveStoryItem(false);
                }
                else {
                    moveStoryItem(true);
                }
            }
        };
        zuck.callback('onEnd')(zuck.internalData.currentStory, callback);
    };
    var close = function () {
        var modalContainer = document.querySelector('#zuck-modal');
        var modalContent = document.querySelector('#zuck-modal-content');
        var callback = function () {
            if (zuck.option('backNative') && (0, utils_1.hasWindow)()) {
                window.location.hash = '';
            }
            fullScreen(modalContainer, true);
            if (modalContainer) {
                if (zuck.option('openEffect')) {
                    modalContainer.classList.add('closed');
                }
                else {
                    if (modalContent) {
                        modalContent.innerHTML = '';
                    }
                    modalContainer.style.display = 'none';
                }
            }
        };
        zuck.callback('onClose')(zuck.internalData.currentStory, callback);
    };
    modalZuckContainer.modal = {
        show: show,
        next: next,
        close: close
    };
    return modalZuckContainer.modal;
};
exports.modal = modal;


//# sourceURL=webpack://Zuck/./src/modal.ts?`)}),"./src/options.ts":((__unused_webpack_module,exports,__webpack_require__)=>{eval(`
exports.__esModule = true;
exports.loadOptions = exports.option = exports.optionsDefault = void 0;
var utils_1 = __webpack_require__(/*! ./utils */ "./src/utils.ts");
var optionsDefault = function (option) { return ({
    rtl: false,
    skin: 'snapgram',
    avatars: true,
    stories: [],
    backButton: true,
    backNative: false,
    paginationArrows: false,
    previousTap: true,
    autoFullScreen: false,
    openEffect: true,
    cubeEffect: false,
    list: false,
    localStorage: true,
    callbacks: {
        onOpen: function (storyId, callback) {
            // on open story viewer
            callback();
        },
        onView: function (storyId, callback) {
            // on view story
            callback === null || callback === void 0 ? void 0 : callback();
        },
        onEnd: function (storyId, callback) {
            // on end story
            callback();
        },
        onClose: function (storyId, callback) {
            // on close story viewer
            callback();
        },
        onNextItem: function (storyId, nextStoryId, callback) {
            // on navigate item of story
            callback();
        },
        onNavigateItem: function (storyId, nextStoryId, callback) {
            // use to update state on your reactive framework
            callback();
        },
        onDataUpdate: function (data, callback) {
            // use to update state on your reactive framework
            callback();
        }
    },
    template: {
        timelineItem: function (itemData) {
            return "\\n        <div class=\\"story ".concat(itemData['seen'] === true ? 'seen' : '', "\\">\\n          <a class=\\"item-link\\" ").concat(itemData['link'] ? "href=\\"".concat(itemData['link'] || '', "\\"") : '', ">\\n            <span class=\\"item-preview\\">\\n              <img lazy=\\"eager\\" src=\\"").concat(option('avatars') || !itemData['currentPreview']
                ? itemData['photo']
                : itemData['currentPreview'], "\\" />\\n            </span>\\n            <span class=\\"info\\" itemProp=\\"author\\" itemScope itemType=\\"http://schema.org/Person\\">\\n              <strong class=\\"name\\" itemProp=\\"name\\">").concat(itemData['name'], "</strong>\\n              <span class=\\"time\\">").concat((0, utils_1.timeAgo)(itemData['lastUpdated'] || itemData['time'], option('language')) || '', "</span>\\n            </span>\\n          </a>\\n\\n          <ul class=\\"items\\"></ul>\\n        </div>");
        },
        timelineStoryItem: function (itemData) {
            var reserved = [
                'id',
                'seen',
                'src',
                'link',
                'linkText',
                'loop',
                'time',
                'type',
                'length',
                'preview'
            ];
            var attributes = "";
            for (var dataKey in itemData) {
                if (reserved.indexOf(dataKey) === -1) {
                    if (itemData[dataKey] !== undefined && itemData[dataKey] !== false) {
                        attributes += " data-".concat(dataKey, "=\\"").concat(itemData[dataKey], "\\"");
                    }
                }
            }
            reserved.forEach(function (dataKey) {
                if (itemData[dataKey] !== undefined && itemData[dataKey] !== false) {
                    attributes += " data-".concat(dataKey, "=\\"").concat(itemData[dataKey], "\\"");
                }
            });
            return "<a href=\\"".concat(itemData['src'], "\\" ").concat(attributes, ">\\n                <img loading=\\"auto\\" src=\\"").concat(itemData['preview'], "\\" />\\n              </a>");
        },
        viewerItem: function (storyData, currentStoryItem) {
            return "<div class=\\"story-viewer\\">\\n                <div class=\\"head\\">\\n                  <div class=\\"left\\">\\n                    ".concat(option('backButton') ? '<a class="back">&lsaquo;</a>' : '', "\\n\\n                    <span class=\\"item-preview\\">\\n                      <img lazy=\\"eager\\" class=\\"profilePhoto\\" src=\\"").concat(storyData['photo'], "\\" />\\n                    </span>\\n\\n                    <div class=\\"info\\">\\n                      <strong class=\\"name\\">").concat(storyData['name'], "</strong>\\n                      <span class=\\"time\\">").concat((0, utils_1.timeAgo)(storyData['time'], option('language')) || '', "</span>\\n                    </div>\\n                  </div>\\n\\n                  <div class=\\"right\\">\\n                    <span class=\\"time\\">\\n                      ").concat((0, utils_1.timeAgo)(currentStoryItem['time'], option('language')) ||
                '', "\\n                    </span>\\n                    <span class=\\"loading\\"></span>\\n                    <a class=\\"close\\" tabIndex=\\"2\\">&times;</a>\\n                  </div>\\n                </div>\\n\\n                <div class=\\"slides-pointers\\">\\n                  <div class=\\"wrap\\"></div>\\n                </div>\\n\\n                ").concat(option('paginationArrows')
                ? "\\n                    <div class=\\"slides-pagination\\">\\n                      <span class=\\"previous\\">&lsaquo;</span>\\n                      <span class=\\"next\\">&rsaquo;</span>\\n                    </div>"
                : '', "\\n              </div>");
        },
        viewerItemPointerProgress: function (style) {
            return "<span class=\\"progress\\" style=\\"".concat(style, "\\"></span>");
        },
        viewerItemPointer: function (index, currentIndex, item) {
            return "<span\\n                class=\\"\\n                  ".concat(currentIndex === index ? 'active' : '', "\\n                  ").concat(item['seen'] === true ? 'seen' : '', "\\n                \\"\\n                data-index=\\"").concat(index, "\\" data-item-id=\\"").concat(item['id'], "\\">\\n                  ").concat(option('template')['viewerItemPointerProgress']("animation-duration:".concat((0, utils_1.safeNum)(item['length']) ? item['length'] : '3', "s")), "\\n              </span>");
        },
        viewerItemBody: function (index, currentIndex, item) {
            return "<div\\n                class=\\"\\n                  item\\n                  ".concat(item['seen'] === true ? 'seen' : '', "\\n                  ").concat(currentIndex === index ? 'active' : '', "\\n                \\"\\n                data-time=\\"").concat(item['time'], "\\"\\n                data-type=\\"").concat(item['type'], "\\"\\n                data-index=\\"").concat(index, "\\"\\n                data-item-id=\\"").concat(item['id'], "\\">\\n                ").concat(item['type'] === 'video'
                ? "<video class=\\"media\\" data-length=\\"".concat(item.length, "\\" ").concat(item.loop ? 'loop' : '', " muted webkit-playsinline playsinline preload=\\"auto\\" src=\\"").concat(item['src'], "\\" ").concat(item['type'], "></video>\\n                    <b class=\\"tip muted\\">").concat(option('language')['unmute'], "</b>")
                : "<img loading=\\"auto\\" class=\\"media\\" src=\\"".concat(item['src'], "\\" ").concat(item['type'], " />\\n                "), "\\n\\n                ").concat(item['link']
                ? "<a class=\\"tip link\\" href=\\"".concat(item['link'], "\\" rel=\\"noopener\\" target=\\"_blank\\">\\n                        ").concat(item['linkText'] || option('language')['visitLink'], "\\n                      </a>")
                : '', "\\n              </div>");
        }
    },
    language: {
        unmute: 'Touch to unmute',
        keyboardTip: 'Press space to see next',
        visitLink: 'Visit link',
        time: {
            ago: 'ago',
            hour: 'hour ago',
            hours: 'hours ago',
            minute: 'minute ago',
            minutes: 'minutes ago',
            fromnow: 'from now',
            seconds: 'seconds ago',
            yesterday: 'yesterday',
            tomorrow: 'tomorrow',
            days: 'days ago'
        }
    }
}); };
exports.optionsDefault = optionsDefault;
var option = function (options, _name) {
    var self = function (name) {
        return typeof (options === null || options === void 0 ? void 0 : options[name]) !== 'undefined'
            ? options === null || options === void 0 ? void 0 : options[name]
            : (0, exports.optionsDefault)(self)[name];
    };
    return self(_name);
};
exports.option = option;
var loadOptions = function (options) {
    return {
        option: function (name) {
            return (0, exports.option)(options, name);
        },
        callback: function (name) {
            var customOpts = (0, exports.option)(options, 'callbacks');
            return typeof customOpts[name] !== undefined
                ? customOpts[name]
                : (0, exports.option)(undefined, 'callbacks')[name];
        },
        template: function (name) {
            var customOpts = (0, exports.option)(options, 'template');
            return typeof customOpts[name] !== undefined
                ? customOpts[name]
                : (0, exports.option)(undefined, 'template')[name];
        },
        language: function (name) {
            var customOpts = (0, exports.option)(options, 'language');
            return typeof customOpts[name] !== undefined
                ? customOpts[name]
                : (0, exports.option)(undefined, 'language')[name];
        }
    };
};
exports.loadOptions = loadOptions;


//# sourceURL=webpack://Zuck/./src/options.ts?`)}),"./src/utils.ts":((__unused_webpack_module,exports)=>{eval(`
exports.__esModule = true;
exports.timeAgo = exports.findPos = exports.generateId = exports.prepend = exports.onTransitionEnd = exports.onAnimationEnd = exports.safeNum = exports.hasWindow = void 0;
var hasWindow = function () {
    return typeof window !== 'undefined';
};
exports.hasWindow = hasWindow;
var safeNum = function (num) {
    return num ? Number(num) : 0;
};
exports.safeNum = safeNum;
var onAnimationEnd = function (el, func) {
    el.addEventListener('animationend', func);
};
exports.onAnimationEnd = onAnimationEnd;
var onTransitionEnd = function (el, func) {
    if (!el.transitionEndEvent) {
        el.transitionEndEvent = true;
        el.addEventListener('transitionend', func);
    }
};
exports.onTransitionEnd = onTransitionEnd;
var prepend = function (parent, child) {
    if (!child || !parent) {
        return;
    }
    if (parent === null || parent === void 0 ? void 0 : parent.firstChild) {
        parent.insertBefore(child, parent === null || parent === void 0 ? void 0 : parent.firstChild);
    }
    else {
        parent.appendChild(child);
    }
};
exports.prepend = prepend;
var generateId = function () {
    return 'stories-' + Math.random().toString(36).substr(2, 9);
};
exports.generateId = generateId;
var findPos = function (obj, offsetY, offsetX, stop) {
    var curleft = 0;
    var curtop = 0;
    if (obj) {
        if (obj.offsetParent) {
            do {
                curleft += obj.offsetLeft;
                curtop += obj.offsetTop;
                if (obj === stop) {
                    break;
                }
            } while ((obj = obj.offsetParent));
        }
        if (offsetY) {
            curtop = curtop - offsetY;
        }
        if (offsetX) {
            curleft = curleft - offsetX;
        }
    }
    return [curleft, curtop];
};
exports.findPos = findPos;
var timeAgo = function (time, languageObject) {
    var language = (languageObject === null || languageObject === void 0 ? void 0 : languageObject.time) || undefined;
    var timeNumber = time instanceof Date ? time.getTime() : (0, exports.safeNum)(time) * 1000;
    var dateObj = new Date(timeNumber);
    var dateStr = dateObj.getTime();
    var seconds = (new Date().getTime() - dateStr) / 1000;
    var formats = [
        [60, " ".concat((language === null || language === void 0 ? void 0 : language.seconds) || ''), 1],
        [120, "1 ".concat((language === null || language === void 0 ? void 0 : language.minute) || ''), ''],
        [3600, " ".concat((language === null || language === void 0 ? void 0 : language.minutes) || ''), 60],
        [7200, "1 ".concat((language === null || language === void 0 ? void 0 : language.hour) || ''), ''],
        [86400, " ".concat((language === null || language === void 0 ? void 0 : language.hours) || ''), 3600],
        [172800, " ".concat((language === null || language === void 0 ? void 0 : language.yesterday) || ''), ''],
        [604800, " ".concat((language === null || language === void 0 ? void 0 : language.days) || ''), 86400]
    ];
    var currentFormat = 1;
    if (seconds < 0) {
        seconds = Math.abs(seconds);
        currentFormat = 2;
    }
    var result = false;
    formats.forEach(function (format) {
        var formatKey = format[0];
        if (seconds < formatKey && !result) {
            if (typeof format[2] === 'string') {
                result = format[currentFormat];
            }
            else if (format !== null) {
                result = Math.floor(seconds / format[2]) + format[1];
            }
        }
    });
    if (!result) {
        var day = dateObj.getDate();
        var month = dateObj.getMonth();
        var year = dateObj.getFullYear();
        return "".concat(day, "/").concat(month + 1, "/").concat(year);
    }
    else {
        return result;
    }
};
exports.timeAgo = timeAgo;


//# sourceURL=webpack://Zuck/./src/utils.ts?`)})},__webpack_module_cache__={};function __webpack_require__(n){var t=__webpack_module_cache__[n];if(t!==void 0)return t.exports;var e=__webpack_module_cache__[n]={exports:{}};return __webpack_modules__[n](e,e.exports,__webpack_require__),e.exports}var __webpack_exports__=__webpack_require__("./src/index.ts");exports.Zuck=__webpack_exports__.default})()});export default a();
