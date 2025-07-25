var isResizing = false;

(function () {
  var container = document.getElementById("container"),
    left = document.getElementById("left_panel"),
    right = document.getElementById("right_panel"),
    handle = document.getElementById("drag");

  handle.onmousedown = function (e) {
    isResizing = true;
  };

  document.onmousemove = function (e) {
    // we don't want to do anything if we aren't resizing.
    if (!isResizing) {
      return;
    }

    var offsetRight = container.clientWidth - (e.clientX - container.offsetLeft);

    left.style.right = offsetRight + "px";
    right.style.width = offsetRight + "px";
  }

  document.onmouseup = function (e) {
    // stop resizing
    isResizing = false;
  }
 
  left.style.right = "40vw";
  right.style.width = "40vw";
})();