/**
 * @class EventData
 * Represents event data, providing methods to control event propagation.
 */
class EventData {
  constructor() {
    /**
     * @private
     * @type {boolean}
     */
    this._isPropagationStopped = false;
    /**
     * @private
     * @type {boolean}
     */
    this._isImmediatePropagationStopped = false;
  }

  /**
   * Stops event from propagating up the DOM tree.
   * @method stopPropagation
   */
  stopPropagation() {
    this._isPropagationStopped = true;
  }

  /**
   * Returns whether stopPropagation was called on this event object.
   * @method isPropagationStopped
   * @return {boolean}
   */
  isPropagationStopped() {
    return this._isPropagationStopped;
  }

  /**
   * Prevents the rest of the handlers from being executed.
   * @method stopImmediatePropagation
   */
  stopImmediatePropagation() {
    this._isImmediatePropagationStopped = true;
  }

  /**
   * Returns whether stopImmediatePropagation was called on this event object.
   * @method isImmediatePropagationStopped
   * @return {boolean}
   */
  isImmediatePropagationStopped() {
    return this._isImmediatePropagationStopped;
  }
}

/**
 * @class AppEventService
 * A simple event service for subscribing to and notifying event handlers.
 */
class AppEventService {
  constructor() {
    /**
     * @private
     * @type {Array<Function>}
     */
    this.handlers = [];
  }

  /**
   * Adds an event handler to be called when the event is fired.
   * Event handler will receive two arguments - an `EventData` and the `data`
   * object the event was fired with.
   * @method subscribe
   * @param {Function} fn Event handler.
   */
  subscribe(fn) {
    this.handlers.push(fn);
  }

  /**
   * Removes an event handler added with `subscribe(fn)`.
   * @method unsubscribe
   * @param {Function} fn Event handler to be removed.
   */
  unsubscribe(fn) {
    for (let i = this.handlers.length - 1; i >= 0; i--) {
      if (this.handlers[i] === fn) {
        this.handlers.splice(i, 1);
      }
    }
  }

  /**
   * Fires an event notifying all subscribers.
   * @method notify
   * @param {any} args Additional data object to be passed to all handlers.
   * @param {EventData} [e] Optional. An `EventData` object to be passed to all handlers.
   * For DOM events, an existing W3C/jQuery event object can be passed in.
   * @param {object} [scope] Optional. The scope ("this") within which the handler will be executed.
   * If not specified, the scope will be set to the `AppEventService` instance.
   * @returns {any} The return value of the last executed handler.
   */
  notify(args, e, scope) {
    e = e || new EventData();
    scope = scope || this;

    let returnValue;
    for (let i = 0; i < this.handlers.length && !(e.isPropagationStopped() || e.isImmediatePropagationStopped()); i++) {
      returnValue = this.handlers[i].call(scope, e, args);
    }

    return returnValue;
  }
}

// Export both classes using CommonJS module.exports
module.exports = {
  AppEventService: AppEventService,
  EventData: EventData
};