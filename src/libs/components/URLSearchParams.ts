export class UrlSettings
{
    search = new URLSearchParams(window.location.search);

    isPresent() { return window.location.search && window.location.search.length > 1}

    get(name: string) {
        return this.search.get(name);
    }

    set(name: string, value?: string)
    {
        if(!value || value.trim() === "") this.search.delete(name);
        else this.search.set(name,value);
        this.updatePageUrl();
    }

    updatePageUrl()
    {
        let bareLocation = window.location.href;
        const querySpot = bareLocation.indexOf("?");
        if(querySpot > -1) bareLocation = bareLocation.substr(0,querySpot);
        window.history.pushState(null,null, `${bareLocation}?${this.search.toString()}`);
    }

    clear()
    {
        Array.from(this.search.keys()).forEach(k => this.search.delete(k));
    }
}
