// simple test environment to make sure some things work
import * as DOM from "../dom/DOM"
import { addClass } from "../dom/DOMUtil"
import { hexToRgb, mergeData, classMixin, isTrue, trace, addTraceHandler } from "../core/Util";
import { easeInOutQuint, easeOutStrong } from "../animation/Ease";
import Message from "../ui/Message"
import { Language, fallback } from "../language/Language"
import { I18NMixins } from "../language/I18NMixins";
import Events from "../core/Events";
import { makeConfig } from "../core/ConfigFactory"
import { TimelineConfig } from "../core/TimelineConfig"
import { TimeNav } from "../timenav/TimeNav"
import * as Browser from "../core/Browser"
import { Animate } from "../animation/Animate"
import { StorySlider } from "../slider/StorySlider"
import { MenuBar } from "../ui/MenuBar"

let debug = false; // can we fiddle with this and if others do, does that propogate?

function make_keydown_handler(timeline) {
    return function(event) {
        var keyName = event.key;
        var currentSlide = timeline._getSlideIndex(self.current_id);
        var _n = timeline.config.events.length - 1;
        var lastSlide = timeline.config.title ? _n + 1 : _n;
        var firstSlide = 0;

        if (keyName == 'ArrowLeft') {
            if (currentSlide != firstSlide) {
                timeline.goToPrev();
            }
        } else if (keyName == 'ArrowRight') {
            if (currentSlide != lastSlide) {
                timeline.goToNext();
            }
        }
    }
}

/**
 * Primary entry point for using TimelineJS.
 * @constructor
 * @param {HTMLElement|string} elem - the HTML element, or its ID, to which 
 *     the Timeline should be bound
 * @param {object} - a JavaScript object conforming to the TimelineJS 
 *     configuration format
 * @param {object} [options] - a JavaScript object specifying 
 *     presentation options
 */
class Timeline {
    constructor(elem, data, options) {
        this.ready = false;
        this._el = {
            container: DOM.get(elem),
            storyslider: {},
            timenav: {},
            menubar: {}
        };

        this.language = fallback;

        // Slider
        this._storyslider = {};

        // TimeNav
        this._timenav = {};

        // Menu Bar
        this._menubar = {};

        // Loaded State
        this._loaded = { storyslider: false, timenav: false };

        // Data Object
        this.config = null;

        this.options = {
            script_path: "",
            height: this._el.container.offsetHeight,
            width: this._el.container.offsetWidth,
            debug: false,
            is_embed: false,
            is_full_embed: false,
            hash_bookmark: false,
            default_bg_color: { r: 255, g: 255, b: 255 },
            scale_factor: 2, // How many screen widths wide should the timeline be
            layout: "landscape", // portrait or landscape
            timenav_position: "bottom", // timeline on top or bottom
            optimal_tick_width: 60, // optimal distance (in pixels) between ticks on axis
            base_class: "tl-timeline", // removing tl-timeline will break all default stylesheets...
            timenav_height: null,
            timenav_height_percentage: 25, // Overrides timenav height as a percentage of the screen
            timenav_mobile_height_percentage: 40, // timenav height as a percentage on mobile devices
            timenav_height_min: 175, // Minimum timenav height
            marker_height_min: 30, // Minimum Marker Height
            marker_width_min: 100, // Minimum Marker Width
            marker_padding: 5, // Top Bottom Marker Padding
            start_at_slide: 0,
            start_at_end: false,
            menubar_height: 0,
            skinny_size: 650,
            medium_size: 800,
            use_bc: false, // Use declared suffix on dates earlier than 0
            // animation
            duration: 1000,
            ease: easeInOutQuint,
            // interaction
            dragging: true,
            trackResize: true,
            map_type: "stamen:toner-lite",
            slide_padding_lr: 100, // padding on slide of slide
            slide_default_fade: "0%", // landscape fade
            zoom_sequence: [0.5, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89], // Array of Fibonacci numbers for TimeNav zoom levels
            language: "en",
            ga_property_id: null,
            track_events: ['back_to_start', 'nav_next', 'nav_previous', 'zoom_in', 'zoom_out']
        };

        // Animation Objects
        this.animator_timenav = null;
        this.animator_storyslider = null;
        this.animator_menubar = null;

        // Ideally we'd set the language here, but we're bootstrapping and may hit problems
        // before we're able to load it. if it weren't a remote resource, we could probably 
        // do it.
        this.message = new Message(this._el.container, { message_class: "tl-message-full" });

        // Merge Options
        if (options && typeof(options.default_bg_color) == "string") {
            var parsed = hexToRgb(options.default_bg_color); // will clear it out if its invalid
            if (parsed) {
                options.default_bg_color = parsed;
            } else {
                delete options.default_bg_color
                trace("Invalid default background color. Ignoring.");
            }
        }
        mergeData(this.options, options);

        if (!(this.options.script_path)) {
            this.options.script_path = this.determineScriptPath()
        }

        document.addEventListener("keydown", make_keydown_handler(this));
        window.addEventListener("resize", function(e) {
            this.updateDisplay();
        }.bind(this));

        if (this.options.debug) {
            addTraceHandler(console.log)
        }

        // Apply base class to container
        addClass(this._el.container, 'tl-timeline');

        if (this.options.is_embed) {
            addClass(this._el.container, 'tl-timeline-embed');
        }

        if (this.options.is_full_embed) {
            addClass(this._el.container, 'tl-timeline-full-embed');
        }

        this._loadLanguage(data);

    }

    _loadLanguage(data) {
        try {
            var lang = this.options.language
            var script_path = this.options.script_path
            this.language = new Language(lang, script_path)
            this.message.setLanguage(this.language)
            this.options.language = this.language // easiest way to make language available to I18NMixins
            this.showMessage(this._('loading_timeline'))
            this._initData(data)
        } catch (e) {
            this.showMessage(this._translateError(e))
        }
    }

    /**
     * Initialize the data for this timeline. If data is a URL, pass it to ConfigFactory
     * to get a TimelineConfig; if data is a TimelineConfig, just use it; otherwise, 
     * assume it's a JSON object in the right format, and wrap it in a new TimelineConfig.
     * @param {string|TimelineConfig|object} data
     */
    _initData(data) {
        if (typeof data == 'string') {
            makeConfig(data, function(config) {
                this.setConfig(config);
            }.bind(this));
        } else if (TimelineConfig == data.constructor) {
            this.setConfig(data);
        } else {
            this.setConfig(new TimelineConfig(data));
        }
    }

    /**
     * Given an input, if it is a Timeline Error object, look up the
     * appropriate error in the current language and return it, optionally 
     * with detail that also comes in the object. Alternatively, pass back
     * the input, which is expected to be a string ready to display.
     * @param {Error|string} e - an Error object which can be localized, 
     *     or a string message
     */
    _translateError(e) {

        if (e.hasOwnProperty('stack')) {
            trace(e.stack);
        }
        if (e.message_key) {
            return this._(e.message_key) + (e.detail ? ' [' + e.detail + ']' : '')
        }
        return e;

    }

    /**
     * Display a message in the Timeline window.
     * @param {string} msg 
     */
    showMessage(msg) {
            if (this.message) {
                this.message.updateMessage(msg);
            } else {
                trace("No message display available.")
                trace(msg);
            }
        }
        /**
         * Not ideal, but if users don't specify the script path, we try to figure it out.
         * The script path is needed to load other languages
         */
    determineScriptPath() {
        var script_tags = document.getElementsByTagName('script');
        var src = script_tags[script_tags.length - 1].src;
        if (src) {
            return src.substr(0, src.lastIndexOf('/'));
        }
        return '';
    }


    setConfig(config) {
        this.config = config;
        this.config.validate();
        this._validateOptions();
        if (this.config.isValid()) {
            try {
                this._onDataLoaded();
            } catch (e) {
                this.showMessage("<strong>" + this._('error') + ":</strong> " + this._translateError(e));
            }
        } else {
            var translated_errs = [];

            for (var i = 0, errs = this.config.getErrors(); i < errs.length; i++) {
                translated_errs.push(this._translateError(errs[i]));
            }

            this.showMessage("<strong>" + this._('error') + ":</strong> " + translated_errs.join('<br>'));
            // should we set 'self.ready'? if not, it won't resize,
            // but most resizing would only work
            // if more setup happens
        }
    }

    _onDataLoaded() {
        this.fire("dataloaded");
        this._initLayout();
        this._initEvents();
        this._initAnalytics();
        if (this.message) {
            this.message.hide();
        }

        this.ready = true;

    }

    _initLayout() {
        var self = this;

        this.message.removeFrom(this._el.container);
        this._el.container.innerHTML = "";

        // Create Layout
        if (this.options.timenav_position == "top") {
            this._el.timenav = DOM.create('div', 'tl-timenav', this._el.container);
            this._el.storyslider = DOM.create('div', 'tl-storyslider', this._el.container);
        } else {
            this._el.storyslider = DOM.create('div', 'tl-storyslider', this._el.container);
            this._el.timenav = DOM.create('div', 'tl-timenav', this._el.container);
        }

        this._el.menubar = DOM.create('div', 'tl-menubar', this._el.container);


        // Initial Default Layout
        this.options.width = this._el.container.offsetWidth;
        this.options.height = this._el.container.offsetHeight;
        // this._el.storyslider.style.top  = "1px";

        // Set TimeNav Height
        this.options.timenav_height = this._calculateTimeNavHeight(this.options.timenav_height);

        // Create TimeNav
        this._timenav = new TimeNav(this._el.timenav, this.config, this.options, this.language);
        this._timenav.on('loaded', this._onTimeNavLoaded, this);
        this._timenav.options.height = this.options.timenav_height;
        this._timenav.init();

        // intial_zoom cannot be applied before the timenav has been created
        if (this.options.initial_zoom) {
            // at this point, this.options refers to the merged set of options
            this.setZoom(this.options.initial_zoom);
        }

        // Create StorySlider
        this._storyslider = new StorySlider(this._el.storyslider, this.config, this.options, this.language);
        this._storyslider.on('loaded', this._onStorySliderLoaded, this);
        this._storyslider.init();

        // Create Menu Bar
        this._menubar = new MenuBar(this._el.menubar, this._el.container, this.options);

        // LAYOUT
        if (this.options.layout == "portrait") {
            this.options.storyslider_height = (this.options.height - this.options.timenav_height - 1);
        } else {
            this.options.storyslider_height = (this.options.height - 1);
        }


        // Update Display
        this._updateDisplay(this._timenav.options.height, true, 2000);

    }

    _initEvents() {
        // TimeNav Events
        this._timenav.on('change', this._onTimeNavChange, this);
        this._timenav.on('zoomtoggle', this._onZoomToggle, this);

        // StorySlider Events
        this._storyslider.on('change', this._onSlideChange, this);
        this._storyslider.on('colorchange', this._onColorChange, this);
        this._storyslider.on('nav_next', this._onStorySliderNext, this);
        this._storyslider.on('nav_previous', this._onStorySliderPrevious, this);

        // Menubar Events
        this._menubar.on('zoom_in', this._onZoomIn, this);
        this._menubar.on('zoom_out', this._onZoomOut, this);
        this._menubar.on('back_to_start', this._onBackToStart, this);

    }

    _onColorChange(e) {
        this.fire("color_change", { unique_id: this.current_id }, this);
    }

    _onSlideChange(e) {
        if (this.current_id != e.unique_id) {
            this.current_id = e.unique_id;
            this._timenav.goToId(this.current_id);
            this._onChange(e);
        }
    }

    _onTimeNavChange(e) {
        if (this.current_id != e.unique_id) {
            this.current_id = e.unique_id;
            this._storyslider.goToId(this.current_id);
            this._onChange(e);
        }
    }

    _onZoomToggle(e) {
        if (e.zoom == "in") {
            this._menubar.toogleZoomIn(e.show);
        } else if (e.zoom == "out") {
            this._menubar.toogleZoomOut(e.show);
        }

    }



    _onChange(e) {
        this.fire("change", { unique_id: this.current_id }, this);
        if (this.options.hash_bookmark && this.current_id) {
            this._updateHashBookmark(this.current_id);
        }
    }

    _onBackToStart(e) {
        this._storyslider.goTo(0);
        this.fire("back_to_start", { unique_id: this.current_id }, this);
    }

    /**
     * Zoom in and zoom out should be part of the public API.
     */
    zoomIn() {
        this._timenav.zoomIn();
    }
    zoomOut() {
        this._timenav.zoomOut();
    }

    setZoom(level) {
        this._timenav.setZoom(level);
    }

    _onZoomIn(e) {
        this._timenav.zoomIn();
        this.fire("zoom_in", { zoom_level: this._timenav.options.scale_factor }, this);
    }

    _onZoomOut(e) {
        this._timenav.zoomOut();
        this.fire("zoom_out", { zoom_level: this._timenav.options.scale_factor }, this);
    }

    _onTimeNavLoaded() {
        this._loaded.timenav = true;
        this._onLoaded();
    }

    _onStorySliderLoaded() {
        this._loaded.storyslider = true;
        this._onLoaded();
    }

    _onStorySliderNext(e) {
        this.fire("nav_next", e);
    }

    _onStorySliderPrevious(e) {
        this.fire("nav_previous", e);
    }


    _updateDisplay(timenav_height, animate, d) {
        var duration = this.options.duration,
            display_class = this.options.base_class,
            menu_position = 0,
            self = this;

        if (d) {
            duration = d;
        }

        // Update width and height
        this.options.width = this._el.container.offsetWidth;
        this.options.height = this._el.container.offsetHeight;

        // Check if skinny
        if (this.options.width <= this.options.skinny_size) {
            display_class += " tl-skinny";
            this.options.layout = "portrait";
        } else if (this.options.width <= this.options.medium_size) {
            display_class += " tl-medium";
            this.options.layout = "landscape";
        } else {
            this.options.layout = "landscape";
        }

        // Detect Mobile and Update Orientation on Touch devices
        if (Browser.touch) {
            this.options.layout = Browser.orientation();
        }

        if (Browser.mobile) {
            display_class += " tl-mobile";
            // Set TimeNav Height
            this.options.timenav_height = this._calculateTimeNavHeight(timenav_height, this.options.timenav_mobile_height_percentage);
        } else {
            // Set TimeNav Height
            this.options.timenav_height = this._calculateTimeNavHeight(timenav_height);
        }

        // LAYOUT
        if (this.options.layout == "portrait") {
            // Portrait
            display_class += " tl-layout-portrait";

        } else {
            // Landscape
            display_class += " tl-layout-landscape";

        }

        // Set StorySlider Height
        this.options.storyslider_height = (this.options.height - this.options.timenav_height);

        // Positon Menu
        if (this.options.timenav_position == "top") {
            menu_position = (Math.ceil(this.options.timenav_height) / 2) - (this._el.menubar.offsetHeight / 2) - (39 / 2);
        } else {
            menu_position = Math.round(this.options.storyslider_height + 1 + (Math.ceil(this.options.timenav_height) / 2) - (this._el.menubar.offsetHeight / 2) - (35 / 2));
        }


        if (animate) {

            this._el.timenav.style.height = Math.ceil(this.options.timenav_height) + "px";

            // Animate StorySlider
            if (this.animator_storyslider) {
                this.animator_storyslider.stop();
            }
            this.animator_storyslider = Animate(this._el.storyslider, {
                height: this.options.storyslider_height + "px",
                duration: duration / 2,
                easing: easeOutStrong
            });

            // Animate Menubar
            if (this.animator_menubar) {
                this.animator_menubar.stop();
            }

            this.animator_menubar = Animate(this._el.menubar, {
                top: menu_position + "px",
                duration: duration / 2,
                easing: easeOutStrong
            });

        } else {
            // TimeNav
            this._el.timenav.style.height = Math.ceil(this.options.timenav_height) + "px";

            // StorySlider
            this._el.storyslider.style.height = this.options.storyslider_height + "px";

            // Menubar
            this._el.menubar.style.top = menu_position + "px";
        }

        if (this.message) {
            this.message.updateDisplay(this.options.width, this.options.height);
        }
        // Update Component Displays
        this._timenav.updateDisplay(this.options.width, this.options.timenav_height, animate);
        this._storyslider.updateDisplay(this.options.width, this.options.storyslider_height, animate, this.options.layout);

        if (this.options.language.direction == 'rtl') {
            display_class += ' tl-rtl';
        }


        // Apply class
        this._el.container.className = display_class;

    }

    /**
     * Compute the height of the navigation section of the Timeline, taking 
     *     into account the possibility of an explicit height or height 
     *     percentage, but also honoring the `timenav_height_min` option 
     *     value. If `timenav_height` is specified it takes precedence over 
     *     `timenav_height_percentage` but in either case, if the resultant 
     *     pixel height is less than `options.timenav_height_min` then the 
     *     value of `options.timenav_height_min` will be returned. (A minor 
     *     adjustment is made to the returned value to account for marker 
     *     padding.)
     * 
     * @param {number} [timenav_height] - an integer value for the desired height in pixels
     * @param {number} [timenav_height_percentage] - an integer between 1 and 100
     */
    _calculateTimeNavHeight(timenav_height, timenav_height_percentage) {

        var height = 0;

        if (timenav_height) {
            height = timenav_height;
        } else {
            if (this.options.timenav_height_percentage || timenav_height_percentage) {
                if (timenav_height_percentage) {
                    height = Math.round((this.options.height / 100) * timenav_height_percentage);
                } else {
                    height = Math.round((this.options.height / 100) * this.options.timenav_height_percentage);
                }

            }
        }

        // Set new minimum based on how many rows needed
        if (this._timenav.ready) {
            if (this.options.timenav_height_min < this._timenav.getMinimumHeight()) {
                this.options.timenav_height_min = this._timenav.getMinimumHeight();
            }
        }

        // If height is less than minimum set it to minimum
        if (height < this.options.timenav_height_min) {
            height = this.options.timenav_height_min;
        }

        height = height - (this.options.marker_padding * 2);

        return height;
    }

    _validateOptions() {
        // assumes that this.options and this.config have been set.
        var INTEGER_PROPERTIES = ['timenav_height', 'timenav_height_min', 'marker_height_min', 'marker_width_min', 'marker_padding', 'start_at_slide', 'slide_padding_lr'];

        for (var i = 0; i < INTEGER_PROPERTIES.length; i++) {
            var opt = INTEGER_PROPERTIES[i];
            var value = this.options[opt];
            let valid = true;
            if (typeof(value) == 'number') {
                valid = (value == parseInt(value))
            } else if (typeof(value) == "string") {
                valid = (value.match(/^\s*(\-?\d+)?\s*$/));
            }
            if (!valid) {
                this.config.logError({ message_key: 'invalid_integer_option', detail: opt });
            }
        }
    }

    /*  Get index of slide by id
  ================================================== */
    _getSlideIndex(id) {
        if (this.config.title && this.config.title.unique_id == id) {
            return 0;
        }
        for (var i = 0; i < this.config.events.length; i++) {
            if (id == this.config.events[i].unique_id) {
                return this.config.title ? i + 1 : i;
            }
        }
        return -1;
    }

    _onTimeNavLoaded() {
        this._loaded.timenav = true;
        this._onLoaded();
    }

    _onStorySliderLoaded() {
        this._loaded.storyslider = true;
        this._onLoaded();
    }

    _onLoaded() {
        if (this._loaded.storyslider && this._loaded.timenav) {
            this.fire("loaded", this.config);
            // Go to proper slide
            if (this.options.hash_bookmark && window.location.hash != "") {
                this.goToId(window.location.hash.replace("#event-", ""));
            } else {
                if (isTrue(this.options.start_at_end) || this.options.start_at_slide > this.config.events.length) {
                    this.goToEnd();
                } else {
                    this.goTo(this.options.start_at_slide);
                }
                if (this.options.hash_bookmark) {
                    this._updateHashBookmark(this.current_id);
                }
            }

        }
    }

    // Update hashbookmark in the url bar
    _updateHashBookmark(id) {
        var hash = "#" + "event-" + id.toString();
        window.history.replaceState(null, "Browsing TimelineJS", hash);
        this.fire("hash_updated", { unique_id: this.current_id, hashbookmark: "#" + "event-" + id.toString() }, this);
    }


    // Goto slide with id
    goToId(id) {
        if (this.current_id != id) {
            this.current_id = id;
            this._timenav.goToId(this.current_id);
            this._storyslider.goToId(this.current_id, false, true);
            this.fire("change", { unique_id: this.current_id }, this);
        }
    }

    // Goto slide n
    goTo(n) {
        if (this.config.title) {
            if (n == 0) {
                this.goToId(this.config.title.unique_id);
            } else {
                this.goToId(this.config.events[n - 1].unique_id);
            }
        } else {
            this.goToId(this.config.events[n].unique_id);
        }
    }

    // Goto first slide
    goToStart() {
        this.goTo(0);
    }

    // Goto last slide
    goToEnd() {
        var _n = this.config.events.length - 1;
        this.goTo(this.config.title ? _n + 1 : _n);
    }

    // Goto previous slide
    goToPrev() {
        this.goTo(this._getSlideIndex(this.current_id) - 1);
    }

    // Goto next slide
    goToNext() {
        this.goTo(this._getSlideIndex(this.current_id) + 1);
    }

    updateDisplay() {
        if (this.ready) {
            this._updateDisplay();
        }
    }

    _initGoogleAnalytics() {
        (function(i, s, o, g, r, a, m) {
            i['GoogleAnalyticsObject'] = r;
            i[r] = i[r] || function() {
                (i[r].q = i[r].q || []).push(arguments)
            }, i[r].l = 1 * new Date();
            a = s.createElement(o), m = s.getElementsByTagName(o)[0];
            a.async = 1;
            a.src = g;
            m.parentNode.insertBefore(a, m)
        })(window, document, 'script', '//www.google-analytics.com/analytics.js', 'ga');

        ga('create', this.options.ga_property_id, 'auto');
        ga('set', 'anonymizeIp', true);
    }

    _initAnalytics() {
        if (this.options.ga_property_id === null) { return; }
        this._initGoogleAnalytics();
        ga('send', 'pageview');
        var events = this.options.track_events;
        for (i = 0; i < events.length; i++) {
            var event_ = events[i];
            this.addEventListener(event_, function(e) {
                ga('send', 'event', e.type, 'clicked');
            });
        }
    }


}

classMixin(Timeline, I18NMixins, Events)

export { Timeline }