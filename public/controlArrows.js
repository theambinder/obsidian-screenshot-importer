export function decorateSelects(root = document) {
  for (const select of root.querySelectorAll('select')) {
    if (select.parentElement.classList.contains('select-control')) continue;
    const wrapper = document.createElement('span');
    wrapper.className = 'select-control';
    if (select.classList.contains('compact-sort')) {
      wrapper.classList.add('compact-sort');
      select.classList.remove('compact-sort');
    }
    select.before(wrapper);
    wrapper.append(select);
  }
}
