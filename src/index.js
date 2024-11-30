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

    // Get profile info using public API
    const profileResponse = await fetch(
      `${CORS_PROXY_URL}https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${handle}`,
      {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      }
    );

    const profileData = await profileResponse.json();
    return {
      did: profileData.did,
      collection: 'app.bsky.feed.post',
      rkey,
      profile: profileData
    };
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
      `${CORS_PROXY_URL}https://api.bsky.app/xrpc/app.bsky.feed.getPostThread?depth=0&uri=at://${did}/${collection}/${rkey}`,
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

    const threadData = await response.json();
    return threadData.thread.post;
  } catch (error) {
    console.error('Error fetching Bluesky post:', error);
    throw error;
  }
}

async function uploadFile(originalUrl) {
  try {
    // Fetch the image through the CORS proxy
    const proxyUrl = `${CORS_PROXY_URL}${originalUrl}`;
    const response = await fetch(proxyUrl);
    const blob = await response.blob();

    // Create a File object from the blob
    const filename = originalUrl.split('/').pop();
    const file = new File([blob], filename, { type: blob.type });

    // Upload using new file API
    const uploadedUrl = await window.roamAlphaAPI.file.upload({
      file: file,
      toast: { hide: true }
    });
    
    // Return as markdown image
    if (blob.type.startsWith('image/')) {
      return `![](${uploadedUrl})`;
    } else if (blob.type.startsWith('video/')) {
      return uploadedUrl;
    }

    return uploadedUrl;
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
  let thread = await fetchBlueskyPost(postURL);
  let postData = thread;

  // Extract post info
  let postText = postData.record.text;
  let postDate = postData.record.createdAt;
  let authorHandle = postData.author.handle;
  let authorName = postData.author.displayName;

  // Convert post date to roam date format
  let roamDate = new Date(Date.parse(postDate));
  roamDate = window.roamAlphaAPI.util.dateToPageTitle(roamDate);

  // Parse post with template
  var parsedPost = template.replaceAll('{POST}', postText);
  parsedPost = parsedPost.replaceAll('{URL}', postURL);
  parsedPost = parsedPost.replaceAll('{AUTHOR_NAME}', authorName || authorHandle);
  parsedPost = parsedPost.replaceAll('{AUTHOR_HANDLE}', authorHandle);
  parsedPost = parsedPost.replaceAll('{AUTHOR_URL}', `https://bsky.app/profile/${authorHandle}`);
  parsedPost = parsedPost.replaceAll('{DATE}', roamDate);
  parsedPost = parsedPost.replaceAll('{NEWLINE}', "\n");
  
  // Handle media embeds (images or video)
  if (postData.embed) {
    if (postData.embed.$type === 'app.bsky.embed.images#view') {
      if (imageLocation === 'inline') {
        let parsedImages = "";
        for (const image of postData.embed.images) {
          const cleanedAttachment = await uploadFile(image.fullsize);
          if (cleanedAttachment) {
            parsedImages = parsedImages.concat(" ", cleanedAttachment);
          }
        }
        parsedPost = parsedPost.replaceAll('{IMAGES}', parsedImages);
      } else if (imageLocation === 'skip images') {
        parsedPost = parsedPost.replaceAll('{IMAGES}', "");
      } else {
        parsedPost = parsedPost.replaceAll('{IMAGES}', "");
        for (const image of postData.embed.images) {
          const cleanedAttachment = await uploadFile(image.fullsize);
          if (cleanedAttachment) {
            window.roamAlphaAPI.createBlock({
              "location": {
                "parent-uid": uid,
                "order": 'last'
              },
              "block": {
                "string": cleanedAttachment
              }
            });
          }
        }
      }
    } else if (postData.embed.$type === 'app.bsky.embed.video#view') {
      if (imageLocation === 'skip images') {
        parsedPost = parsedPost.replaceAll('{IMAGES}', "");
      } else {
        const videoUrl = `https://bsky.social/xrpc/com.atproto.sync.getBlob?did=${postData.author.did}&cid=${postData.embed.cid}`;


        const cleanedAttachment = await uploadFile(videoUrl);
        
        if (cleanedAttachment) {
          const videoStr = cleanedAttachment;
          if (imageLocation === 'inline') {
            
            parsedPost = parsedPost.replaceAll('{IMAGES}', videoStr);
          } else {
            parsedPost = parsedPost.replaceAll('{IMAGES}', "");
            window.roamAlphaAPI.createBlock({
              "location": {
                "parent-uid": uid,
                "order": 'last'
              },
              "block": { 
                "string": videoStr
              }
            });
          }
        }
      }
    } else {
      parsedPost = parsedPost.replaceAll('{IMAGES}', "");
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