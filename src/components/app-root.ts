class AppRoot extends HTMLElement {
  connectedCallback() {
    this.textContent = "Lorcana Deckbuilder (skeleton)";
    // TODO: render real layout.
  }
}

customElements.define("app-root", AppRoot);
