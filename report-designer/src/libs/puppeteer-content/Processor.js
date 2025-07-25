
Handlebars.registerHelper('resource', (value) => {
    const apc = window.resourceContext[value] || null;
    if(apc)
        return new Handlebars.SafeString(apc); 
    return null;
});

function cleanUp() {
    const scripts = document.getElementsByTagName("script");
    for (var i = scripts.length - 1; i >= 0; --i)
        scripts.item(i).remove();
}


window.processHandlebar = function () {
    var source = document.getElementById("entry-template").innerHTML;
    var template = Handlebars.compile(source);
    var html = template(window.processContext);
    document.body.innerHTML = html;

    //styles
    var styleSource = document.getElementById("style-template");
    if (styleSource != null) {
        var stylesTemplate = Handlebars.compile(styleSource.innerHTML);
        var css = stylesTemplate(window.processContext);
        document.getElementById('def-style').innerHTML += " " + css;
    }

    //execute custom script
    if (appScript)
        appScript();

    cleanUp();

    return true;
}
