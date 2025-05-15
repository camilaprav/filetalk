import autoassist from 'https://esm.sh/@camilaprav/kittygpt@0.0.36/autoassist.js';
import completion from 'https://esm.sh/@camilaprav/kittygpt@0.0.36/completion.js';
import panzoom from 'https://esm.sh/panzoom';
import lf from 'https://esm.sh/localforage';
import { lookup as mimeLookup } from 'https://esm.sh/mrmime';

export default class Filechat {
  state = {
    view: null,
    uploadProgress: 0,
    list: [],
    loading: 0,

    get media() {
      return /^image|audio|video\//.test(this.mime) && this.current;
    },
  };

  actions = {
    init: async () => {
      await post('filechat.list');
      await post(
        'filechat.changeView',
        this.state.list.length ? 'dashboard' : 'upload',
      );
    },

    upload: async () => {
      this.state.uploadProgress = 0;
      d.update();
      let f = await selectFile();
      await lf.setItem(`filechat:file:${f.name}`, f);
      await post('filechat.list');
      for (let i = 0; i < 100; i += Math.random() * 10 + 5) {
        await new Promise(pres => setTimeout(pres, Math.random() * 100 + 100));
        i = Math.min(100, i);
        this.state.uploadProgress = i;
        d.update();
      }
      this.state.uploadProgress = 100;
      d.update();
      await new Promise(pres => setTimeout(pres, 2500));
      await post('filechat.changeView', 'dashboard');
      this.state.uploadProgress = 0;
    },

    list: async () => {
      this.state.list = (await lf.keys())
        .filter(x => x.startsWith('filechat:file:'))
        .map(x => x.slice('filechat:file:'.length));
    },

    changeView: async x => {
      this.state.view = x;
      if (!this.state.session && x === 'dashboard') {
        try {
          this.state.loading++;
          d.update();
          this.state.session = await autoassist({
            endpoint:
              'https://kittygpt.netlify.app/.netlify/functions/voicechat',
          });
          this.state.session.sysupdate(
            {
              main: `You're File Chat, a service for talking to AI about any file type.`,
              images: `When asked about an open image, use imagePrompt function to get it sent to OpenAI for analysis.`,
              videos: `When asked about an open video, use videoPrompt function to get the current frame sent to OpenAI for analysis.`,
            },
            this.fns,
          );
        } catch (err) {
          console.error(err);
          this.state.session = null;
          d.update();
        } finally {
          this.state.loading--;
        }
      }
    },

    select: async x => {
      let canvas = document.querySelector('#Canvas');
      canvas.innerHTML = '';
      let mime = mimeLookup(x);
      let unrecognized = () =>
        (canvas.innerHTML = `<div class="text-3xl">Unrecognized file type</div>`);
      if (!mime) return unrecognized();
      switch (mime.split('/')[0]) {
        case 'image': {
          let img = d.el('img', { src: await post('filechat.load', x) });
          canvas.append(img);
          panzoom(img);
          break;
        }

        case 'video':
          canvas.append(
            d.el('video', {
              src: await post('filechat.load', x),
              controls: true,
            }),
          );
          break;
      }
      this.state.mime = mime;
      this.state.current = x;
    },

    load: async x => {
      let blob = await lf.getItem(`filechat:file:${x}`);
      if (!blob) throw new Error(`File not found`);
      return await urifor(blob);
    },

    rm: async (ev, x) => {
      ev?.preventDefault?.();
      ev?.stopPropagation?.();
      await lf.removeItem(`filechat:file:${x}`);
      await post('filechat.list');
      if (!this.state.list.length) await post('filechat.changeView', 'upload');
    },
  };

  fns = {
    imagePrompt: {
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string' },
        },
        required: [`prompt`],
      },
      handler: async ({ prompt }) => {
        console.log('imagePrompt:', prompt);
        if (!this.state.mime?.startsWith('image/'))
          return tap({
            success: false,
            error: `The open file is not an image`,
          });
        try {
          this.state.loading++;
          d.update();
          let uri = await post('filechat.load', this.state.current);
          if ((uri.length > 4 * 1024) & 1024)
            return { success: false, error: `File too large for analysis` };
          console.log(`Starting image analysis...`);
          let res = await completion(
            [
              {
                role: 'user',
                content: [
                  { type: 'text', text: prompt },
                  { type: 'image_url', image_url: { url: uri } },
                ],
              },
            ],
            {
              endpoint:
                'https://kittygpt.netlify.app/.netlify/functions/completion',
              model: 'gpt-4.1',
            },
          );
          console.log(`Image analysis complete:`, res.content);
          return { success: true, analysis: [res.content] };
        } catch (err) {
          console.error(err);
          return { success: false, error: err.message };
        } finally {
          this.state.loading--;
          d.update();
        }
      },
    },
  };
}

function tap(x) {
  return console.log(x), x;
}

async function selectFile(accept) {
  let { promise: p, resolve: res } = Promise.withResolvers();
  let input = d.el('input', { type: 'file', accept, class: 'hidden' });
  input.addEventListener('change', ev => res(input.files[0]));
  top.document.body.append(input);
  input.click();
  input.remove();
  return p;
}

async function urifor(blob) {
  return await new Promise((pres, prej) => {
    const reader = new FileReader();
    reader.onloadend = () => pres(reader.result);
    reader.onerror = prej;
    reader.readAsDataURL(blob);
  });
}
