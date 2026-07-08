/**
 * app/carnets/accroche.js — Bannière glissante éphémère lors d'une bascule de carnet
 */

export function showAccroche(carnet) {
    // Remove any existing accroche
    document.querySelector('.lrz-accroche')?.remove();

    const banner = document.createElement('div');
    banner.className = 'lrz-accroche';
    banner.setAttribute('aria-live', 'polite');
    banner.setAttribute('aria-atomic', 'true');
    banner.innerHTML = `
    <span class="lrz-accroche__emoji">${carnet.icon}</span>
    <span class="lrz-accroche__text">
      Carnet <strong>${carnet.label}</strong> ouvert.
      <em>${carnet.promise}</em>
    </span>
  `;
    document.body.appendChild(banner);

    requestAnimationFrame(() => {
        requestAnimationFrame(() => banner.classList.add('is-visible'));
    });

    setTimeout(() => banner.classList.remove('is-visible'), 2800);
    setTimeout(() => banner.remove(), 3700);
}
