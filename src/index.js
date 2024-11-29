import pkg from '../package.json';

var defaultPostTemplate = '[[>]] {POST} {NEWLINE} [🦋]({URL}) by {AUTHOR_NAME} on [[{DATE}]]'
const CORS_PROXY_URL = `${window.roamAlphaAPI.constants.corsAnywhereProxyUrl}/`

function getPostTemplate(extensionAPI) {
  return extensionAPI.settings.get('post-template') || defaultPostTemplate
}

function getimageLocation(extensionAPI) {
  return extensionAPI.settings.get('image-location') || "child block"
}

function getAutoExtractTag(extensionAPI) {
  return extensionAPI.settings.get('auto-extract-tag') || "bluesky-extract"
}

const panelConfig = {
  tabTitle: "Bluesky Extract",
  settings: [
    {
      id: "post-template",
      name: "Post Template",
      description: "variables available are {POST}, {URL}, {AUTHOR_NAME}, {AUTHOR_HANDLE}, {AUTHOR_URL}, {DATE}, {NEWLINE}, {IMAGES}",
      action: {
        type: "input",
        placeholder: defaultPostTemplate,
      }
    },
    {
      id: "image-location",
      name: "Image Location",
      description: "If there are images attached to a post where should they be added",
      action: {
        type: "select",
        items: ["child block", "inline", "skip images"],
      }
    },
    {
      id: "auto-extract",
      name: "Auto Extract",
      description: "When Roam loads if there are blocks tagged with the Auto Extract Tag they will be automatically extracted.",
      action: { type: "switch" }
    },
    {
      id: "auto-extract-tag",
      name: "Auto Extract Tag",
      description: "",
      action: {
        type: "input",
        placeholder: "bluesky-extract"
      }
    }
  ]
};

async function parseBlueskyUrl(url) {
  if (url.includes('bsky.app')) {
    const parts = url.split('/');
    const handle = parts[parts.indexOf('profile') + 1];
    const rkey = parts[parts.indexOf('post') + 1];

    const didResponse = await fetch(
      `${CORS_PROXY_URL}https://bsky.social/xrpc/com.atproto.identity.resolveHandle?handle=${handle}`,
      {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      }
    );

    const { did } = await didResponse.json();
    return { did, collection: 'app.bsky.feed.post', rkey };
  }

  if (url.startsWith('at://')) {
    const [_, did, collection, rkey] = url.split('/');
    return { did, collection, rkey };
  }

  throw new Error('Invalid Bluesky URL format');
}

async function fetchBlueskyPost(url) {
  try {
    const { did, collection, rkey } = await parseBlueskyUrl(url);

    const response = await fetch(
      `${CORS_PROXY_URL}https://bsky.social/xrpc/com.atproto.repo.getRecord?repo=${did}&collection=${collection}&rkey=${rkey}`,
      {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error fetching Bluesky post:', error);
    throw error;
  }
}

async function uploadFile(originalUrl) {
  const CORS_PROXY_URL = window.roamAlphaAPI.constants.corsAnywhereProxyUrl;

  try {
    // Fetch the image through the CORS proxy
    const proxyUrl = `${CORS_PROXY_URL}/${originalUrl}`;
    const response = await fetch(proxyUrl);
    const blob = await response.blob();

    // Create a File object from the blob
    const filename = originalUrl.split('/').pop();
    const file = new File([blob], filename, { type: blob.type });

    // Upload to Roam
    const uploadedUrl = await window.roamAlphaAPI.util.uploadFile({
      file: file,
    });

    // Extract the markdown URL
    const MD_IMAGE_REGEX = /\!\[\]\((.*)\)/g;
    const strippedUrl = [...uploadedUrl.matchAll(MD_IMAGE_REGEX)];
    const cleanUrl = strippedUrl?.[0]?.[0] ?? uploadedUrl;

    return cleanUrl;
  } catch (error) {
    console.error('Error uploading file:', error);
    return null;
  }
}

function addSpinner(blockUID) {
  const MySpinner = React.createElement(
    window.Blueprint.Core.Spinner,
    { intent: "primary", size: Blueprint.Core.SpinnerSize.SMALL },
    null
  );

  const elements = document.querySelectorAll('div, textarea');

  for (let i = 0; i < elements.length; i++) {
    const element = elements[i];
    if (element.id.includes('block-input') && element.id.includes(blockUID)) {
      const postSpinner = document.createElement('div');
      postSpinner.className = "bluesky-extract-pending";
      postSpinner.style.marginRight = "10px";
      postSpinner.style.marginTop = "5px";
      postSpinner.style.width = "24px";
      ReactDOM.render(MySpinner, postSpinner);

      if (element.tagName.toLowerCase() === 'textarea') {
        element.parentNode.parentNode.insertBefore(postSpinner, element.parentNode);
      } else {
        element.parentNode.insertBefore(postSpinner, element);
      }
      break;
    }
  }
}

function removeSpinner(blockUID) {
  const divs = document.getElementsByClassName('bluesky-extract-pending');
  for (let i = divs.length - 1; i >= 0; i--) {
    const div = divs[i];
    const nextDiv = div.nextElementSibling;
    if (nextDiv) {
      if (nextDiv.id.includes('block-input') && nextDiv.id.includes(blockUID)) {
        div.parentNode.removeChild(div);
      } else if (nextDiv.classList.contains('rm-autocomplete__wrapper')) {
        const firstChildDiv = nextDiv.firstChild;
        if (firstChildDiv && firstChildDiv.id.includes('block-input') && firstChildDiv.id.includes(blockUID)) {
          div.parentNode.removeChild(div);
        }
      }
    }
  }
}

function extractCurrentBlock(uid, template, imageLocation) {
  let query = `[:find ?s .
                :in $ ?uid
                :where 
                  [?e :block/uid ?uid]
                  [?e :block/string ?s]
              ]`;

  let block_string = window.roamAlphaAPI.q(query, uid);
  extractPost(uid, block_string, template, imageLocation);
}

async function extractPost(uid, post, template, imageLocation) {
  addSpinner(uid);

  const regex = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/;
  var urlRegex = new RegExp(regex, 'ig');

  function getPostUrl(content) {
    let urlsTab = content.match(urlRegex);
    if (urlsTab != null) {
      return urlsTab[urlsTab.length - 1];
    } else {
      return 0;
    }
  }

  let postURL = getPostUrl(post);
  let postData = await fetchBlueskyPost(postURL);

  // Extract post info
  let postText = postData.value.text;
  let postDate = postData.value.createdAt;
  let authorHandle = postURL.split('/')[4]; // Extract from URL for now

  // Convert post date to roam date format
  let roamDate = new Date(Date.parse(postDate));
  roamDate = window.roamAlphaAPI.util.dateToPageTitle(roamDate);

  // Parse post with template
  var parsedPost = template.replaceAll('{POST}', postText);
  parsedPost = parsedPost.replaceAll('{URL}', postURL);
  parsedPost = parsedPost.replaceAll('{AUTHOR_HANDLE}', authorHandle);
  parsedPost = parsedPost.replaceAll('{AUTHOR_URL}', `https://bsky.app/profile/${authorHandle}`);
  parsedPost = parsedPost.replaceAll('{DATE}', roamDate);
  parsedPost = parsedPost.replaceAll('{NEWLINE}', "\n");

  // Handle images
  if (postData.value.embed && postData.value.embed.$type === 'app.bsky.embed.images') {
    if (imageLocation === 'inline') {
      let parsedImages = "";
      for (const image of postData.value.embed.images) {
        const imageUrl = `https://cdn.bsky.social/imgproxy/${image.image.ref.$link}`;
        const cleanedAttachment = await uploadFile(imageUrl);
        if (cleanedAttachment) {
          parsedImages = parsedImages.concat(" ", cleanedAttachment);
        }
      }
      parsedPost = parsedPost.replaceAll('{IMAGES}', parsedImages);
    } else if (imageLocation === 'skip images') {
      parsedPost = parsedPost.replaceAll('{IMAGES}', "");
    } else {
      parsedPost = parsedPost.replaceAll('{IMAGES}', "");
      for (const image of postData.value.embed.images) {
        const imageUrl = `https://cdn.bsky.social/imgproxy/${image.image.ref.$link}`;
        const cleanedAttachment = await uploadFile(imageUrl);
        if (cleanedAttachment) {
          window.roamAlphaAPI.createBlock({
            "location":
            {
              "parent-uid": uid,
              "order": 'last'
            },
            "block":
              { "string": cleanedAttachment }
          });
        }
      }
    }
  } else {
    parsedPost = parsedPost.replaceAll('{IMAGES}', "");
  }

  window.roamAlphaAPI.updateBlock({
    block: {
      uid: uid,
      string: parsedPost
    }
  });

  removeSpinner(uid);
}

function getPageRefs(page) {
  let query = `[:find (pull ?refs [:block/string :node/title :block/uid])
                :in $ ?namespace
                :where
                  [?e :node/title ?namespace]
                  [?refs :block/refs ?e]
              ]`;

  let result = window.roamAlphaAPI.q(query, page).flat();
  return result;
}

async function onload({ extensionAPI }) {
  console.log("load bluesky extract plugin");

  extensionAPI.settings.panel.create(panelConfig);

  extensionAPI.ui.commandPalette.addCommand({
    label: 'Extract Bluesky Post',
    callback: () => {
      let block = window.roamAlphaAPI.ui.getFocusedBlock();
      if (block != null) {
        extractCurrentBlock(
          block['block-uid'],
          getPostTemplate(extensionAPI),
          getimageLocation(extensionAPI)
        );
      }
    },
    "disable-hotkey": false,
    "default-hotkey": "ctrl-shift-b"
  });

  window.roamAlphaAPI.ui.blockContextMenu.addCommand({
    label: "Extract Bluesky Post",
    callback: (e) => extractPost(
      e['block-uid'],
      e['block-string'],
      getPostTemplate(extensionAPI),
      getimageLocation(extensionAPI)
    )
  });

  // Auto extract
  if (extensionAPI.settings.get('auto-extract')) {
    let posts = await getPageRefs(getAutoExtractTag(extensionAPI));
    for (const post of posts) {
      try {
        await extractPost(
          post.uid,
          post.string,
          getPostTemplate(extensionAPI),
          getimageLocation(extensionAPI)
        );
      } catch (error) {
        console.error(error, post);
      }
    }
  }

  console.log(`${pkg.name} version ${pkg.version} loaded`);

}

function onunload() {
  window.roamAlphaAPI.ui.blockContextMenu.removeCommand({
    label: "Extract Bluesky Post"
  });
  console.log(`${pkg.name} version ${pkg.version} unloaded`);
}

export default {
  onload,
  onunload
};