const appRoot = document.querySelector("#app");

appRoot.innerHTML = `
<div class="sp-app d-flex">
  <aside class="sp-sidebar d-flex flex-column p-3" id="sidebar">
    <div class="fw-bold fs-4 mb-4">sellersPro</div>
    <nav class="d-grid gap-1">
      <a class="text-white text-decoration-none p-2 rounded" href="#">Dashboard</a>
      <a class="text-white text-decoration-none p-2 rounded" href="#">Orders</a>
      <a class="text-white text-decoration-none p-2 rounded" href="#">Products</a>
      <a class="text-white text-decoration-none p-2 rounded" href="#">Categories</a>
      <a class="text-white text-decoration-none p-2 rounded" href="#">Customers</a>
      <a class="text-white text-decoration-none p-2 rounded" href="#">Inventory</a>
      <a class="text-white text-decoration-none p-2 rounded" href="#">Analytics</a>
    </nav>
    <div class="mt-auto">
      <a class="text-white text-decoration-none p-2 d-block" href="#">Subscription</a>
      <a class="text-white text-decoration-none p-2 d-block" href="#">Settings</a>
    </div>
  </aside>

  <main class="sp-main flex-grow-1">
    <header class="bg-white border-bottom">
      <div class="d-flex align-items-center justify-content-between px-3 px-md-4 py-3">
        <button class="btn btn-light d-lg-none" id="menuButton" type="button">☰</button>
        <div class="fw-semibold">Dashboard</div>
        <div class="small text-secondary">sellersPro</div>
      </div>
    </header>

    <section class="sp-content p-3 p-md-4">
      <div class="sp-card p-4">
        <h1 class="h4">sellersPro foundation</h1>
        <p class="mb-0 text-secondary">
          Responsive project foundation is running successfully.
        </p>
      </div>
    </section>
  </main>
</div>`;

document.querySelector("#menuButton")?.addEventListener("click", () => {
  document.querySelector("#sidebar")?.classList.toggle("is-open");
});

/*
 Firebase will be connected after the Firebase project is created.
 This starter intentionally renders without requiring Firebase config,
 so opening the HTML does not produce a blank screen.
*/
