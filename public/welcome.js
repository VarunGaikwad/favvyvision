'use strict';

const form = document.querySelector('#domain-form');
const domain = document.querySelector('#domain');
const preview = document.querySelector('#preview');
const image = document.querySelector('#favicon-preview');
const placeholder = document.querySelector('#placeholder');
const status = document.querySelector('#status');
const requestURL = document.querySelector('#request-url');
const openImage = document.querySelector('#open-image');
const copyButton = document.querySelector('#copy-button');
const copyStatus = document.querySelector('#copy-status');
const fetchButton = document.querySelector('#fetch-button');
let activeRequest;
let imageURL;

copyButton.hidden = false;

async function tryDomain() {
  if (!form.reportValidity()) return;
  activeRequest?.abort();
  const controller = new AbortController();
  activeRequest = controller;
  const hostname = domain.value.trim();
  const path = '/favicon?domain=' + encodeURIComponent(hostname);
  requestURL.value = new URL(path, window.location.origin).href;
  openImage.href = path;
  copyStatus.textContent = '';
  image.hidden = true;
  image.removeAttribute('src');
  if (imageURL) URL.revokeObjectURL(imageURL);
  imageURL = undefined;
  placeholder.hidden = false;
  preview.setAttribute('aria-busy', 'true');
  status.textContent = 'Looking up ' + hostname + '…';
  fetchButton.disabled = true;
  try {
    const response = await fetch(path, { signal: controller.signal });
    if (!response.ok) {
      const messages = {
        400: 'Enter a public hostname, without a URL, port, or path.',
        404: 'No favicon found. Try another domain.',
        502: 'Icon providers are unavailable. Please try again.',
        503: 'The service is busy. Please try again shortly.',
        504: 'The lookup timed out. Please try again.'
      };
      throw new Error(messages[response.status] || 'Could not fetch this favicon. Please try again.');
    }
    const blob = await response.blob();
    if (controller.signal.aborted) return;
    imageURL = URL.createObjectURL(blob);
    image.onload = () => {
      image.hidden = false;
      placeholder.hidden = true;
      status.textContent = 'Hello, ' + hostname + '.';
    };
    image.onerror = () => {
      status.textContent = 'The returned image could not be displayed. Try another domain.';
    };
    image.alt = 'Favicon for ' + hostname;
    image.src = imageURL;
  } catch (error) {
    if (controller.signal.aborted) return;
    status.textContent = error instanceof TypeError
      ? 'Could not connect. Check your connection and try again.' : error.message;
  } finally {
    if (!controller.signal.aborted) {
      preview.setAttribute('aria-busy', 'false');
      fetchButton.disabled = false;
    }
  }
}

form.addEventListener('submit', event => {
  event.preventDefault();
  tryDomain();
});
document.querySelectorAll('[data-domain]').forEach(example => {
  example.addEventListener('click', event => {
    event.preventDefault();
    domain.value = example.dataset.domain;
    tryDomain();
  });
});
copyButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(new URL(requestURL.value, window.location.origin).href);
    copyStatus.textContent = 'URL copied.';
  } catch {
    requestURL.focus();
    requestURL.select();
    copyStatus.textContent = 'Select and copy the URL above.';
  }
});
