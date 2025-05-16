import autoassist from 'https://esm.sh/@camilaprav/kittygpt@0.0.41/autoassist.js';
import completion from 'https://esm.sh/@camilaprav/kittygpt@0.0.41/completion.js';
import panzoom from 'https://esm.sh/panzoom';
import lf from 'https://esm.sh/localforage';
import { lookup as mimeLookup } from 'https://esm.sh/mrmime';

export default class Filetalk {
  state = {
    view: null,
    subview: 'explore',
    uploadProgress: 0,
    list: [],
    tempfiles: {},
    loading: 0,
    openMenu: false,
    openList: true,
    autoassist: false,

    get media() {
      return /^image|audio|video\//.test(this.mime) && this.current;
    },
  };

  actions = {
    init: async () => {
      await post('filetalk.list');
      await post(
        'filetalk.changeView',
        this.state.list.length ? 'dashboard' : 'upload',
      );
    },

    upload: async () => {
      this.state.uploadProgress = 0;
      d.update();
      let f = await selectFile();
      if (f.size > 4 * 1024 * 1024) {
        this.state.tempfiles[f.name] = URL.createObjectURL(f);
        await lf.removeItem(`filetalk:file:${f.name}`);
      } else {
        delete this.state.tempfiles[f.name];
        await lf.setItem(`filetalk:file:${f.name}`, urifor(f));
      }
      await post('filetalk.list');
      for (let i = 0; i < 100; i += Math.random() * 10 + 5) {
        await new Promise(pres => setTimeout(pres, Math.random() * 100 + 100));
        i = Math.min(100, i);
        this.state.uploadProgress = i;
        d.update();
      }
      this.state.uploadProgress = 100;
      d.update();
      await new Promise(pres => setTimeout(pres, 2500));
      await post('filetalk.changeView', 'dashboard');
      this.state.uploadProgress = 0;
    },

    list: async () => {
      this.state.list = (await lf.keys())
        .filter(x => x.startsWith('filetalk:file:'))
        .map(x => x.slice('filetalk:file:'.length))
        .concat(Object.keys(this.state.tempfiles))
        .sort((a, b) => (a < b ? -1 : 1));
    },

    toggleMenu: st => (this.state.openMenu = st ?? !this.state.openMenu),
    toggleList: st => (this.state.openList = st ?? !this.state.openList),

    toggleSubview: async subview => {
      await post('filetalk.toggleMenu', false);
      if (this.state.subview !== subview) {
        this.state.subview = subview;
        await post('filetalk.toggleList', true);
        return;
      }
      await post('filetalk.toggleList', !this.state.current ? true : undefined);
    },

    changeView: async x => {
      this.state.view = x;
      if (!this.state.session && x === 'dashboard')
        await post('filetalk.toggleAutoassist', null, true);
    },

    toggleAutoassist: async (ev, st) => {
      ev?.preventDefault?.();
      ev?.stopPropagation?.();
      if (this.state.loading > 0) return;
      this.state.autoassist = st ?? !this.state.autoassist;
      if (this.state.autoassist) {
        try {
          this.state.loading++;
          d.update();
          this.state.session = await autoassist({
            debug: true,
            endpoint:
              'https://kittygpt.netlify.app/.netlify/functions/voicechat',
          });
          this.state.session.sysupdate(
            {
              main: `You're File Chat, a service for talking to AI about any file type.`,
              images: `When asked about an open image, use imagePrompt function to get it sent to OpenAI for analysis.`,
              videos: `When asked about an open video, use videoPrompt function similarly to query the current frame.`,
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
      } else {
        this.state.session?.stop?.();
        this.state.session = null;
        await post('filetalk.toggleMenu', false);
      }
    },

    select: async x => {
      let canvas = document.querySelector('#Canvas');
      let mime = mimeLookup(x);
      let unrecognized = () =>
        (canvas.innerHTML = `<div class="text-3xl">Unrecognized file type</div>`);
      if (!mime) return unrecognized();
      switch (mime.split('/')[0]) {
        case 'image': {
          let img = d.el('img', { src: await post('filetalk.load', x) });
          canvas.innerHTML = '';
          canvas.append(img);
          panzoom(img);
          break;
        }

        case 'video':
          canvas.innerHTML = '';
          canvas.append(
            d.el('video', {
              src: await post('filetalk.load', x),
              controls: true,
            }),
          );
          break;
      }
      this.state.mime = mime;
      this.state.current = x;
      this.state.session?.sysupdate?.({ currentFile: x, mimeType: mime });
      await post('filetalk.toggleMenu', false);
      await post('filetalk.toggleList', false);
    },

    load: async x => {
      let uri = await lf.getItem(`filetalk:file:${x}`) || this.state.tempfiles[x];
      if (!uri) throw new Error(`File not found`);
      return uri;
    },

    rm: async (ev, x) => {
      ev?.preventDefault?.();
      ev?.stopPropagation?.();
      if (this.state.tempfiles[x]) delete this.state.tempfiles[x];
      else await lf.removeItem(`filetalk:file:${x}`);
      await post('filetalk.list');
      if (!this.state.list.length) await post('filetalk.changeView', 'upload');
    },
  };

  fns = {
    imagePrompt: {
      description: `Don't worry about whether or which image has been selected, call this when asked`,
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string' },
        },
        required: [`prompt`],
      },
      handler: async ({ prompt }) => {
        if (!this.state.mime?.startsWith('image/'))
          return tap({
            success: false,
            error: `The open file is not an image`,
          });
        try {
          this.state.loading++;
          d.update();
          let uri = await post('filetalk.load', this.state.current);
          if ((uri.length > 4 * 1024) & 1024)
            return { success: false, error: `File too large for analysis` };
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
            },
          );
          return { success: true, analysis: res.content };
        } catch (err) {
          console.error(err);
          return { success: false, error: err.message };
        } finally {
          this.state.loading--;
          d.update();
        }
      },
    },

    videoPrompt: {
      description: `Don't worry about whether or which image has been selected, call this when asked`,
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string' },
        },
        required: [`prompt`],
      },
      handler: async ({ prompt }) => {
        if (!this.state.mime?.startsWith('video/'))
          return tap({
            success: false,
            error: `The open file is not a video`,
          });
        try {
          this.state.loading++;
          d.update();
          let uri = b64frame(document.querySelector('video'), 1920);
          if ((uri.length > 4 * 1024) & 1024)
            return { success: false, error: `Frame too large for analysis` };
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
            },
          );
          return { success: true, analysis: res.content };
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
    let reader = new FileReader();
    reader.onloadend = () => pres(reader.result);
    reader.onerror = prej;
    reader.readAsDataURL(blob);
  });
}

function b64frame(vid, size) {
  let originalWidth = vid.videoWidth;
  let originalHeight = vid.videoHeight;
  let width = originalWidth;
  let height = originalHeight;
  if (typeof size === 'number' && size > 0) {
    let scale = Math.min(size / originalWidth, size / originalHeight, 1);
    width = Math.round(originalWidth * scale);
    height = Math.round(originalHeight * scale);
  }
  let canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  let ctx = canvas.getContext('2d');
  ctx.drawImage(vid, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', 0.9);
}
