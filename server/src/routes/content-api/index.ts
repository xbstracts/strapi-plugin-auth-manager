export default () => ({
  type: 'content-api',
  routes: [
    {
      method: 'GET',
      path: '/',
      // name of the controller file & the method.
      handler: 'controller.index',
      config: {
        policies: [],
      },
    },
    {
      method: 'POST',
      path: '/authentications/sync',
      handler: 'controller.sync',
      config: {
        policies: [],
      },
    },
    {
      method: 'GET',
      path: '/authentications/resolve',
      handler: 'controller.resolve',
      config: {
        policies: [],
      },
    },
  ],
});
