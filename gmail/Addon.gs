/**
 * Verlass for Gmail: the add-on's entry points and its connection to the help desk service.
 *
 * Standard install: Service.gs is in this same project, and requests go straight to it.
 * Private install: this project has no Service.gs. Requests go to the help desk's web app,
 * whose address is stored in the script property SERVICE_URL.
 */

var Api = (function () {
  function serviceUrl_() {
    return String(PropertiesService.getScriptProperties().getProperty("SERVICE_URL") || "").trim();
  }

  function isPrivate() {
    return typeof Service === "undefined" || !!serviceUrl_();
  }

  /** Sends one request to the help desk and returns its answer ({ ok, ... }). */
  function call(action, payload) {
    var url = serviceUrl_();
    if (!url) {
      if (typeof Service === "undefined") {
        return { ok: false, errors: ["This add-on is not connected yet. In the Apps Script project, add a script property named SERVICE_URL with the help desk's web app address."] };
      }
      return Service.handle(action, payload || {}, { email: Session.getActiveUser().getEmail(), name: "" });
    }
    if (!/^https:\/\/script\.google\.com\/(a\/)?macros\//.test(url)) {
      return { ok: false, errors: ["SERVICE_URL must be the help desk's web app address. It starts with https://script.google.com/macros/ and ends with /exec."] };
    }
    var response;
    try {
      response = UrlFetchApp.fetch(url, {
        method: "post",
        contentType: "text/plain",
        payload: JSON.stringify({ token: ScriptApp.getIdentityToken(), action: action, payload: payload || {} }),
        muteHttpExceptions: true,
      });
    } catch (e) {
      return { ok: false, errors: ["The help desk service could not be reached. Please try again in a moment."] };
    }
    var text = response.getContentText();
    try {
      var out = JSON.parse(text);
      if (out && typeof out === "object" && typeof out.ok === "boolean") return out;
    } catch (e) {
      // Not JSON: fall through to the message below.
    }
    return { ok: false, errors: ["The help desk service did not answer as expected (code " + response.getResponseCode() + "). Check that SERVICE_URL is the web app address ending in /exec and that the web app allows access by anyone."] };
  }

  return { call: call, isPrivate: isPrivate };
})();

/** Gmail opens this when the add-on's icon is selected. */
function onHomepage(e) {
  return Ui.card(function () {
    return Cards.home(e);
  });
}

/**
 * Optional: Gmail opens this when a message is open, if the manifest has the contextual
 * trigger and the current-message scope (see the install guide). It shows the same home card
 * with a "Create from this email" button.
 */
function onGmailMessage(e) {
  return onHomepage(e);
}

/** Small helpers shared by every card. */
var Ui = (function () {
  /** Runs a card builder. A failure becomes a card that explains it, never a blank panel. */
  function card(build) {
    try {
      return build();
    } catch (err) {
      return errorCard(String((err && err.message) || err));
    }
  }

  /** Runs a button handler. A failure becomes a short notification. */
  function action(run) {
    try {
      return run();
    } catch (err) {
      return notify(String((err && err.message) || err));
    }
  }

  function errorCard(message) {
    return CardService.newCardBuilder()
      .setHeader(CardService.newCardHeader().setTitle("Verlass"))
      .addSection(
        CardService.newCardSection()
          .addWidget(CardService.newTextParagraph().setText(Core.escapeText(message)))
          .addWidget(CardService.newTextButton().setText("Try again").setOnClickAction(CardService.newAction().setFunctionName("uiHome")))
      )
      .build();
  }

  function notify(text) {
    return CardService.newActionResponseBuilder().setNotification(CardService.newNotification().setText(String(text).slice(0, 300))).build();
  }

  /** Throws the service's own message when a request failed. */
  function need(result) {
    if (!result || !result.ok) throw new Error(((result && result.errors) || ["Something went wrong."]).join(" "));
    return result;
  }

  function params(e) {
    return (e && e.parameters) || (e && e.commonEventObject && e.commonEventObject.parameters) || {};
  }

  /** The text of a form field, or "" when it is empty or absent. */
  function field(e, name) {
    var inputs = e && e.commonEventObject && e.commonEventObject.formInputs;
    if (inputs && inputs[name] && inputs[name].stringInputs && inputs[name].stringInputs.value) {
      var values = inputs[name].stringInputs.value;
      return values.length ? String(values[0]) : "";
    }
    if (e && e.formInput && e.formInput[name] !== undefined && e.formInput[name] !== null) return String(e.formInput[name]);
    return "";
  }

  /** True when a switch or check box is on. */
  function isOn(e, name) {
    return field(e, name) !== "";
  }

  function push(card) {
    return CardService.newActionResponseBuilder().setNavigation(CardService.newNavigation().pushCard(card)).build();
  }

  function replace(card, message) {
    var b = CardService.newActionResponseBuilder().setNavigation(CardService.newNavigation().updateCard(card));
    if (message) b.setNotification(CardService.newNotification().setText(message));
    return b.build();
  }

  function button(text, fn, parameters) {
    var a = CardService.newAction().setFunctionName(fn);
    if (parameters) a.setParameters(parameters);
    return CardService.newTextButton().setText(text).setOnClickAction(a);
  }

  function filled(text, fn, parameters, color) {
    return button(text, fn, parameters).setTextButtonStyle(CardService.TextButtonStyle.FILLED).setBackgroundColor(color || "#2F4F40");
  }

  function zone(settings) {
    var tz = (settings && settings.general && settings.general.timeZone) || Session.getScriptTimeZone();
    try {
      Utilities.formatDate(new Date(), tz, "HH");
      return tz;
    } catch (e) {
      return Session.getScriptTimeZone();
    }
  }

  /** "Nov 13, 2:05 PM" in the help desk's time zone. */
  function when(iso, settings) {
    var ms = Core.toMs(iso);
    return isNaN(ms) ? "" : Utilities.formatDate(new Date(ms), zone(settings), "MMM d, h:mm a");
  }

  /** "2026-11-13 14:05", the form people type a due time in. */
  function stamp(iso, settings) {
    var ms = Core.toMs(iso);
    return isNaN(ms) ? "" : Utilities.formatDate(new Date(ms), zone(settings), "yyyy-MM-dd HH:mm");
  }

  /** Reads "2026-11-13 14:05" or "2026-11-13" in the help desk's time zone. Returns ISO, "" for empty, or null when unreadable. */
  function parseStamp(text, settings) {
    var s = String(text || "").trim();
    if (!s) return "";
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]+(\d{1,2}):(\d{2}))?$/.exec(s);
    if (!m) return null;
    var month = Number(m[2]);
    var day = Number(m[3]);
    var hour = m[4] === undefined ? 17 : Number(m[4]);
    var minute = m[5] === undefined ? 0 : Number(m[5]);
    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    try {
      return Utilities.parseDate(m[1] + "-" + pad(month) + "-" + pad(day) + " " + pad(hour) + ":" + pad(minute), zone(settings), "yyyy-MM-dd HH:mm").toISOString();
    } catch (e) {
      return null;
    }
  }

  return { card: card, action: action, errorCard: errorCard, notify: notify, need: need, params: params, field: field, isOn: isOn, push: push, replace: replace, button: button, filled: filled, when: when, stamp: stamp, parseStamp: parseStamp };
})();
