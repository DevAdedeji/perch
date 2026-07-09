export default defineAppConfig({
  ui: {
    colors: {
      // brand accent — amber/gold, used deliberately (primary actions, unread, notes)
      primary: 'amber',
      neutral: 'slate'
    },
    button: {
      // by default Nuxt UI pins leading/trailing icons to the edges on `block`
      // buttons (ms-auto/me-auto); keep the label + icon centered as a group instead
      compoundVariants: [
        {
          block: true,
          class: {
            leadingIcon: 'me-0',
            trailingIcon: 'ms-0'
          }
        }
      ]
    },
    dropdownMenu: {
      slots: {
        content: 'min-w-54'
      }
    }
  }
})
