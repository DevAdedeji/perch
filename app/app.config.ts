export default defineAppConfig({
  ui: {
    colors: {
      primary: 'amber',
      neutral: 'zinc'
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
    }
  }
})
