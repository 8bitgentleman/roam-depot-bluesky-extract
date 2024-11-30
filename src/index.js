import pkg from '../package.json';

var defaultPostTemplate = '[[>]] {POST} {NEWLINE} [🦋]({URL}) by {AUTHOR_NAME} on [[{DATE}]]'
const CORS_PROXY_URL = `${window.roamAlphaAPI.constants.corsAnywhereProxyUrl}/`

console.log('Debug: Starting extension load');
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
function getPostTemplate(extensionAPI) {
  const template = extensionAPI.settings.get('post-template') || defaultPostTemplate;
  console.log('Debug: Got post template:', template);
  return template;
}

function getimageLocation(extensionAPI) {
  const location = extensionAPI.settings.get('image-location') || "child block";
  console.log('Debug: Got image location setting:', location);
  return location;
}

function getAutoExtractTag(extensionAPI) {
  const tag = extensionAPI.settings.get('auto-extract-tag') || "bluesky-extract";
  console.log('Debug: Got auto extract tag:', tag);
  return tag;
}

async function parseBlueskyUrl(url) {
  console.log('Debug: Parsing URL:', url);
  try {
    if (url.includes('bsky.app')) {
      const parts = url.split('/');
      const handle = parts[parts.indexOf('profile') + 1];
      const rkey = parts[parts.indexOf('post') + 1];
      console.log('Debug: Parsed bsky.app URL - handle:', handle, 'rkey:', rkey);

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
      console.log('Debug: Got profile data:', profileData);
      return {
        did: profileData.did,
        collection: 'app.bsky.feed.post',
        rkey,
        profile: profileData
      };
    }

    if (url.startsWith('at://')) {
      const [_, did, collection, rkey] = url.split('/');
      console.log('Debug: Parsed at:// URL - did:', did, 'collection:', collection, 'rkey:', rkey);
      return { did, collection, rkey };
    }

    throw new Error('Invalid Bluesky URL format');
  } catch (error) {
    console.error('Debug: Error parsing URL:', error);
    throw error;
  }
}

async function fetchBlueskyPost(url) {
  console.log('Debug: Fetching post from URL:', url);
  try {
    const { did, collection, rkey } = await parseBlueskyUrl(url);
    console.log('Debug: Parsed URL components - did:', did, 'collection:', collection, 'rkey:', rkey);

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
      console.error('Debug: API response not OK:', response.status, response.statusText);
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const threadData = await response.json();
    console.log('Debug: Got thread data:', threadData);
    return threadData.thread.post;
  } catch (error) {
    console.error('Debug: Error fetching post:', error);
    throw error;
  }
}

async function uploadFile(originalUrl) {
  console.log('Debug: Starting file upload from URL:', originalUrl);
  try {
    const proxyUrl = `${CORS_PROXY_URL}${originalUrl}`;
    console.log('Debug: Using proxy URL:', proxyUrl);

    const response = await fetch(proxyUrl);
    const blob = await response.blob();
    console.log('Debug: Got blob:', blob.type, blob.size);

    const filename = originalUrl.split('/').pop();
    const file = new File([blob], filename, { type: blob.type });
    console.log('Debug: Created file object:', filename, file.type);

    const uploadedUrl = await window.roamAlphaAPI.file.upload({
      file: file,
      toast: { hide: true }
    });
    console.log('Debug: File uploaded successfully:', uploadedUrl);
    
    if (blob.type.startsWith('image/')) {
      return `![](${uploadedUrl})`;
    } else if (blob.type.startsWith('video/')) {
      return uploadedUrl;
    }

    return uploadedUrl;
  } catch (error) {
    console.error('Debug: Error uploading file:', error);
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
  console.log('Debug: Starting post extraction for UID:', uid);
  console.log('Debug: Input post:', post);
  console.log('Debug: Using template:', template);
  console.log('Debug: Image location setting:', imageLocation);

  addSpinner(uid);

  const regex = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/;
  var urlRegex = new RegExp(regex, 'ig');

  function getPostUrl(content) {
    let urlsTab = content.match(urlRegex);
    console.log('Debug: Found URLs in content:', urlsTab);
    if (urlsTab != null) {
      return urlsTab[urlsTab.length - 1];
    } else {
      return 0;
    }
  }

  try {
    let postURL = getPostUrl(post);
    console.log('Debug: Extracted post URL:', postURL);

    let thread = await fetchBlueskyPost(postURL);
    console.log('Debug: Fetched thread data:', thread);
    let postData = thread;

    let postText = postData.record.text;
    let postDate = postData.record.createdAt;
    let authorHandle = postData.author.handle;
    let authorName = postData.author.displayName;

    console.log('Debug: Extracted post details:', {
      postText,
      postDate,
      authorHandle,
      authorName
    });

    let roamDate = new Date(Date.parse(postDate));
    roamDate = window.roamAlphaAPI.util.dateToPageTitle(roamDate);
    console.log('Debug: Converted date to Roam format:', roamDate);

    var parsedPost = template
      .replaceAll('{POST}', postText)
      .replaceAll('{URL}', postURL)
      .replaceAll('{AUTHOR_NAME}', authorName || authorHandle)
      .replaceAll('{AUTHOR_HANDLE}', authorHandle)
      .replaceAll('{AUTHOR_URL}', `https://bsky.app/profile/${authorHandle}`)
      .replaceAll('{DATE}', roamDate)
      .replaceAll('{NEWLINE}', "\n");

    console.log('Debug: Initial parsed post:', parsedPost);
    
    if (postData.embed) {
      console.log('Debug: Processing embed type:', postData.embed.$type);
      
      if (postData.embed.$type === 'app.bsky.embed.images#view') {
        if (imageLocation === 'inline') {
          let parsedImages = "";
          for (const image of postData.embed.images) {
            console.log('Debug: Processing inline image:', image.fullsize);
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
            console.log('Debug: Processing child block image:', image.fullsize);
            const cleanedAttachment = await uploadFile(image.fullsize);
            if (cleanedAttachment) {
              await window.roamAlphaAPI.createBlock({
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
        console.log('Debug: Processing video embed:', postData.embed);
        if (imageLocation === 'skip images') {
          parsedPost = parsedPost.replaceAll('{IMAGES}', "");
        } else {
          const videoUrl = `https://bsky.social/xrpc/com.atproto.sync.getBlob?did=${postData.author.did}&cid=${postData.embed.cid}`;
          console.log('Debug: Video URL:', videoUrl);

          const cleanedAttachment = await uploadFile(videoUrl);
          
          if (cleanedAttachment) {
            const videoStr = cleanedAttachment;
            if (imageLocation === 'inline') {
              parsedPost = parsedPost.replaceAll('{IMAGES}', videoStr);
            } else {
              parsedPost = parsedPost.replaceAll('{IMAGES}', "");
              await window.roamAlphaAPI.createBlock({
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
        console.log('Debug: Unknown embed type, removing {IMAGES} placeholder');
        parsedPost = parsedPost.replaceAll('{IMAGES}', "");
      }
    } else {
      console.log('Debug: No embed found, removing {IMAGES} placeholder');
      parsedPost = parsedPost.replaceAll('{IMAGES}', "");
    }

    console.log('Debug: Final parsed post:', parsedPost);

    await window.roamAlphaAPI.updateBlock({
      block: {
        uid: uid,
        string: parsedPost
      }
    });

    console.log('Debug: Block updated successfully');
    removeSpinner(uid);
  } catch (error) {
    console.error('Debug: Error in extractPost:', error);
    removeSpinner(uid);
    throw error;
  }
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
  console.log('Debug: Extension loading started');
  
  try {
    extensionAPI.settings.panel.create(panelConfig);
    console.log('Debug: Settings panel created');

    extensionAPI.ui.commandPalette.addCommand({
      label: 'Extract Bluesky Post',
      callback: () => {
        let block = window.roamAlphaAPI.ui.getFocusedBlock();
        console.log('Debug: Command palette callback - focused block:', block);
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
    console.log('Debug: Command palette command added');

    window.roamAlphaAPI.ui.blockContextMenu.addCommand({
      label: "Extract Bluesky Post",
      callback: (e) => {
        console.log('Debug: Context menu callback - event:', e);
        extractPost(
          e['block-uid'],
          e['block-string'],
          getPostTemplate(extensionAPI),
          getimageLocation(extensionAPI)
        );
      }
    });
    console.log('Debug: Block context menu command added');

    if (extensionAPI.settings.get('auto-extract')) {
      console.log('Debug: Auto-extract enabled, fetching tagged posts');
      let posts = await getPageRefs(getAutoExtractTag(extensionAPI));
      console.log('Debug: Found tagged posts:', posts);
      
      for (const post of posts) {
        try {
          console.log('Debug: Auto-extracting post:', post);
          await extractPost(
            post.uid,
            post.string,
            getPostTemplate(extensionAPI),
            getimageLocation(extensionAPI)
          );
        } catch (error) {
          console.error('Debug: Error auto-extracting post:', error, post);
        }
      }
    }

    console.log(`Debug: ${pkg.name} version ${pkg.version} loaded successfully`);
  } catch (error) {
    console.error('Debug: Error during extension load:', error);
    throw error;
  }
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