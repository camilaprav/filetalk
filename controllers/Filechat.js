export default class Filechat {
  state = {
    view: 'upload',
    list: ['housing_contract.pdf', 'refactoring_ui.pdf', 'recipes.md'],
    uploadProgress: 0,
  };

  actions = {
    upload: async () => {
      for (let i = 0; i < 100; i += Math.random() * 10 + 1) {
        await new Promise(pres => setTimeout(pres, Math.random() * 500 + 100));
        i = Math.min(100, i);
        this.state.uploadProgress = i;
        console.log(i);
        d.update();
      }
      this.state.uploadProgress = 100;
      d.update();
      await new Promise(pres => setTimeout(pres, 2500));
      this.state.view = 'dashboard';
    },
  };
}
