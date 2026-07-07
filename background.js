// Keep track of active tabs with content scripts
let activeTabsWithContentScript = new Set();

// Track ongoing processes
let ongoingProcesses = {
    contacts: new Map(),  // tabId -> status
    conversations: new Map(),  // tabId -> status
    bulkExport: {
        status: null,
        progress: 0,
        total: 0,
        completed: 0,
        failed: 0,
        message: '',
        startTime: null,
        timestamp: null
    }
};

// Attempt to load JSZip early for background usage
let JSZipPromise = null;
try {
  // For MV3, we need to dynamically import JSZip
  importScripts('jszip.min.js');
  JSZipPromise = Promise.resolve(self.JSZip || JSZip);
} catch (error) {
  console.warn('Could not load JSZip via importScripts, will try dynamic import:', error);
  JSZipPromise = new Promise((resolve, reject) => {
    // We'll try to load it dynamically when needed
    console.log('JSZip will be loaded dynamically when needed');
    resolve(null);
  });
}

// ========== ADDED FUNCTIONS FROM CONTENT.JS ==========

// Function to extract username from URL
function extractUsername(url) {
  // Only extract username from specific inbox URL format
  const match = url.match(/^https:\/\/www\.fiverr\.com\/inbox\/([^\/\?]+)$/);
  return match ? match[1] : null;
}

// Helper function to format date according to user preference
async function formatDate(timestamp) {
  const date = new Date(parseInt(timestamp));
  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = date.getFullYear();
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
  
  // Get user's preferred format from storage, default to DD/MM/YYYY
  return new Promise((resolve) => {
    chrome.storage.local.get(['dateFormat'], function(result) {
      const format = result.dateFormat || 'DD/MM/YYYY';
      
      let dateStr;
      switch(format) {
        case 'MM/DD/YYYY':
          dateStr = `${month}/${day}/${year}`;
          break;
        case 'YYYY/MM/DD':
          dateStr = `${year}/${month}/${day}`;
          break;
        case 'DD-MM-YYYY':
          dateStr = `${day}-${month}-${year}`;
          break;
        default: // DD/MM/YYYY
          dateStr = `${day}/${month}/${year}`;
      }
      
      resolve(`${dateStr}, ${time}`);
    });
  });
}

// Helper function to format file size
function formatFileSize(bytes) {
  if (!bytes || isNaN(bytes)) return 'size unknown';
  if (bytes < 1024) return bytes + ' B';
  else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  else return (bytes / 1048576).toFixed(1) + ' MB';
}

// Function to convert conversation to markdown for background processing
async function convertToMarkdownBg(data) {
  // Get the other user's username from the first message
  let otherUsername = '';
  if (data.messages && data.messages.length > 0) {
    // First try to use the username from URL/extraction command
    if (data.currentUsername) {
      otherUsername = data.currentUsername;
    } else {
      // Get usernames from the first message
      const firstMessage = data.messages[0];
      const sender = firstMessage.sender;
      const recipient = firstMessage.recipient;
      
      // If we have both sender and recipient, determine which one is not the current user
      if (sender && recipient) {
        // Check if data.username is set and is one of the participants
        if (data.username) {
          otherUsername = data.username === sender ? recipient : sender;
        } else {
          // If we can't determine, just use the other user from the first message
          // Typically, if you're viewing a conversation, you're the recipient of the first message
          otherUsername = sender;
        }
      } else {
        // Fallback to whatever username we can find
        otherUsername = recipient || sender || 'unknown';
      }
    }
  }

  let markdown = `# Conversation with ${otherUsername}\n\n`;
  
  // Process messages sequentially to maintain order
  for (const message of data.messages) {
    // Convert Unix timestamp to formatted date using user's preferred format
    const timestamp = await formatDate(message.createdAt);
    const sender = message.sender || 'Unknown';
    
    markdown += `### ${sender} (${timestamp})\n`;
    
    // Show replied-to message if exists
    if (message.repliedToMessage) {
      const repliedMsg = message.repliedToMessage;
      const repliedTime = await formatDate(repliedMsg.createdAt);
      markdown += `> Replying to ${repliedMsg.sender} (${repliedTime}):\n`;
      markdown += `> ${repliedMsg.body.replace(/\n/g, '\n> ')}\n\n`;
    }
    
    // Add message text
    if (message.body) {
      markdown += `${message.body}\n`;
    }

    // Add custom offer details if this is a custom_package message with fetched data
    if (message.type === 'custom_package' && message.customPackageData && message.customPackageData.customPackage) {
      const cp = message.customPackageData.customPackage;
      markdown += `\n**Custom Offer: ${cp.title || ''}**\n\n`;

      markdown += `- **Price:** US$${cp.totalPrice || 0}\n`;
      markdown += `- **Delivery:** ${cp.delivery || 0} Days\n`;
      if (cp.revisions) {
        markdown += `- **Revisions:** ${cp.revisions}\n`;
      }
      if (cp.status) {
        markdown += `- **Status:** ${cp.status}\n`;
      }
      if (cp.encryptedOrderId) {
        markdown += `- **Order ID:** ${cp.encryptedOrderId}\n`;
      }
      if (cp.expiredAt) {
        markdown += `- **Offer expires on:** ${await formatDate(cp.expiredAt)}\n`;
      }
      markdown += '\n';

      if (cp.description) {
        markdown += `**Description:**\n${cp.description}\n\n`;
      }

      if (cp.contentItems && cp.contentItems.length > 0) {
        markdown += `**What's Included:**\n`;
        for (const item of cp.contentItems) {
          if (item.count !== null && item.count !== undefined) {
            markdown += `- ${item.title} - ${item.count}\n`;
          } else {
            markdown += `- ${item.title}\n`;
          }
        }
        markdown += '\n';
      }
    }
    
    // Add attachments if any
    if (message.attachments && message.attachments.length > 0) {
      markdown += '\n**Attachments:**\n';
      for (const attachment of message.attachments) {
        // Check if attachment has required fields
        if (attachment && typeof attachment === 'object') {
          const fileName = attachment.file_name || attachment.filename || 'Unnamed File';
          const fileSize = attachment.file_size || attachment.fileSize || 0;
          const attachmentTime = attachment.created_at ? ` (uploaded on ${await formatDate(attachment.created_at)})` : '';
          markdown += `- ${fileName} (${formatFileSize(fileSize)})${attachmentTime}\n`;
        } else {
          markdown += `- File attachment (size unknown)\n`;
        }
      }
    }
    
    markdown += '\n---\n\n';
  }
  
  return markdown;
}

// Function to convert conversation data to HTML
async function convertToHtmlBg(data) {
  if (!data || !data.messages) {
    return '<html><body><h1>No conversation data available</h1></body></html>';
  }

  // Get the other user's username from the first message using the same logic as markdown
  let otherUsername = '';
  if (data.messages.length > 0) {
    // First try to use the username from URL/extraction command
    if (data.currentUsername) {
      otherUsername = data.currentUsername;
    } else {
      // Get usernames from the first message
      const firstMessage = data.messages[0];
      const sender = firstMessage.sender;
      const recipient = firstMessage.recipient;
      
      // If we have both sender and recipient, determine which one is not the current user
      if (sender && recipient) {
        // Check if data.username is set and is one of the participants
        if (data.username) {
          otherUsername = data.username === sender ? recipient : sender;
        } else {
          // If we can't determine, just use the other user from the first message
          // Typically, if you're viewing a conversation, you're the recipient of the first message
          otherUsername = sender;
        }
      } else {
        // Fallback to whatever username we can find
        otherUsername = recipient || sender || 'unknown';
      }
    }
  }

  // Start building HTML with CSS styles
  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Conversation with ${otherUsername}</title>
  <style>
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f9f9f9;
    }
    h1 {
      color: #1dbf73;
      text-align: center;
      padding-bottom: 10px;
      border-bottom: 2px solid #eee;
      margin-bottom: 30px;
    }
    .message-container {
      margin-bottom: 25px;
      clear: both;
    }
    .message {
      padding: 15px;
      border-radius: 10px;
      max-width: 80%;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      position: relative;
    }
    .sender-info {
      display: flex;
      justify-content: space-between;
      margin-bottom: 5px;
      font-size: 14px;
      color: #666;
    }
    .sender-name {
      font-weight: bold;
      color: #1976d2;
    }
    .timestamp {
      color: #999;
    }
    .message-text {
      white-space: pre-wrap;
      word-break: break-word;
    }
    .sent {
      float: right;
      background-color: #e3f2fd;
      border: 1px solid #bbdefb;
    }
    .received {
      float: left;
      background-color: #ffffff;
      border: 1px solid #e0e0e0;
    }
    .attachments {
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid rgba(0,0,0,0.1);
    }
    .attachment {
      background-color: rgba(0,0,0,0.05);
      padding: 8px;
      border-radius: 5px;
      margin-bottom: 5px;
      font-size: 14px;
      display: flex;
      align-items: center;
    }
    .attachment-icon {
      margin-right: 8px;
      color: #1976d2;
    }
    .replied-message {
      background-color: rgba(0,0,0,0.05);
      border-left: 3px solid #1976d2;
      padding: 8px;
      margin-bottom: 10px;
      border-radius: 0 5px 5px 0;
      font-size: 14px;
    }
    .replied-name {
      font-weight: bold;
      color: #555;
    }
    .replied-text {
      color: #666;
    }
    .clearfix::after {
      content: "";
      clear: both;
      display: table;
    }
    .date-divider {
      text-align: center;
      margin: 30px 0;
      position: relative;
    }
    .date-divider::before {
      content: "";
      position: absolute;
      top: 50%;
      left: 0;
      right: 0;
      height: 1px;
      background-color: #e0e0e0;
      z-index: -1;
    }
    .date-text {
      background-color: #f9f9f9;
      padding: 0 15px;
      color: #999;
      font-size: 14px;
      display: inline-block;
    }
    .custom-offer-box {
      border: 2px solid #1dbf73;
      border-radius: 8px;
      padding: 15px;
      margin: 10px 0;
      background: #f0fdf4;
    }
    .custom-offer-price {
      font-size: 18px;
      font-weight: bold;
      color: #1dbf73;
      margin-bottom: 8px;
    }
    .custom-offer-title {
      margin: 8px 0;
      font-size: 16px;
      font-weight: 600;
      color: #333;
    }
    .custom-offer-description {
      margin: 10px 0;
      color: #555;
      white-space: pre-wrap;
    }
    .custom-offer-includes {
      margin: 10px 0;
    }
    .custom-offer-includes-title {
      font-weight: 600;
      margin-bottom: 5px;
      color: #333;
    }
    .custom-offer-includes ul {
      list-style: none;
      padding-left: 0;
    }
    .custom-offer-includes li {
      padding: 3px 0;
      color: #555;
    }
    .custom-offer-includes li::before {
      content: "✓ ";
      color: #1dbf73;
      font-weight: bold;
    }
    .custom-offer-footer {
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid #d1d5db;
      font-size: 12px;
      color: #999;
    }
    .custom-offer-footer a {
      color: #1976d2;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <h1>Conversation with ${otherUsername}</h1>`;

  let currentDate = null;
  
  // Process messages
  for (const message of data.messages) {
    // Check if we need to add a date divider
    const messageDate = new Date(parseInt(message.createdAt)).toDateString();
    if (messageDate !== currentDate) {
      html += `
  <div class="date-divider">
    <span class="date-text">${messageDate}</span>
  </div>`;
      currentDate = messageDate;
    }

    // Format timestamp
    const formattedTime = await formatDate(message.createdAt);
    
    // Determine message position: always show contact (otherUsername) on the left
    // If the sender is the contact, it should be "received" (left), otherwise "sent" (right)
    const messageType = message.sender === otherUsername ? 'received' : 'sent';
    
    // Start message container
    html += `
  <div class="message-container clearfix">
    <div class="message ${messageType}">
      <div class="sender-info">
        <span class="sender-name">${message.sender}</span>
        <span class="timestamp">${formattedTime}</span>
      </div>`;
    
    // Add replied-to message if it exists
    if (message.repliedToMessage) {
      const repliedMsg = message.repliedToMessage;
      const repliedTime = await formatDate(repliedMsg.createdAt);
      html += `
      <div class="replied-message">
        <div class="replied-name">${repliedMsg.sender} (${repliedTime}):</div>
        <div class="replied-text">${repliedMsg.body}</div>
      </div>`;
    }
    
    // Add message body
    html += `
      <div class="message-text">${message.body || ''}</div>`;

    // Add custom offer box if this is a custom_package message with fetched data
    if (message.type === 'custom_package' && message.customPackageData && message.customPackageData.customPackage) {
      const cp = message.customPackageData.customPackage;
      html += `
      <div class="custom-offer-box">
        <div class="custom-offer-price">US$${cp.totalPrice || 0}</div>
        <div class="custom-offer-title">${cp.title || ''}</div>`;
      if (cp.description) {
        html += `
        <div class="custom-offer-description">${cp.description}</div>`;
      }
      if (cp.contentItems && cp.contentItems.length > 0) {
        html += `
        <div class="custom-offer-includes">
          <div class="custom-offer-includes-title">Your offer includes</div>
          <ul>`;
        if (cp.revisions) {
          html += `
            <li>${cp.revisions} Revisions</li>`;
        }
        html += `
            <li>${cp.delivery || 0} Days Delivery</li>`;
        for (const item of cp.contentItems) {
          if (item.count !== null && item.count !== undefined) {
            html += `
            <li>${item.title} - ${item.count}</li>`;
          } else {
            html += `
            <li>${item.title}</li>`;
          }
        }
        html += `
          </ul>
        </div>`;
      }
      html += `
        <div class="custom-offer-footer">`;
      if (cp.status) {
        html += `Status: ${cp.status}`;
      }
      if (cp.expiredAt) {
        const expiryTime = await formatDate(cp.expiredAt);
        html += `<br>Offer expires on ${expiryTime}`;
      }
      if (cp.orderId) {
        html += `<br><a href="https://www.fiverr.com/orders/${cp.orderId}" target="_blank" rel="noopener noreferrer">View order</a>`;
      }
      html += `
        </div>
      </div>`;
    }
    
    // Add attachments if any
    if (message.attachments && message.attachments.length > 0) {
      html += `
      <div class="attachments">`;
      for (const attachment of message.attachments) {
        if (attachment) {
          const fileName = attachment.filename || attachment.file_name || 'Unnamed File';
          const fileSize = formatFileSize(attachment.fileSize || attachment.file_size || 0);
          const attachmentTime = attachment.created_at ? ` (uploaded on ${await formatDate(attachment.created_at)})` : '';
          html += `
        <div class="attachment">
          <span class="attachment-icon"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg></span>
          ${fileName} (${fileSize})${attachmentTime}
        </div>`;
        }
      }
      html += `
      </div>`;
    }
    
    // Close message container
    html += `
    </div>
  </div>`;
  }
  
  // Close HTML document
  html += `
</body>
</html>`;

  return html;
}

// Function to fetch all contacts recursively in background
async function fetchAllContactsBg(tabId) {
  let allContacts = [];
  let oldestTimestamp = null;
  let batchNumber = 1;
  let totalContactsEstimate = 0;
  
  // Update process tracking
  ongoingProcesses.contacts.set(tabId, {
    status: 'running',
    progress: 'Starting contacts fetch...',
    timestamp: Date.now()
  });
  
  // Clear existing contacts at the start of fetch
  chrome.storage.local.set({ 
    allContacts: [],
    lastContactsFetch: Date.now()
  });
  
  async function fetchContactsBatch(olderThan = null) {
    try {
      const url = olderThan 
        ? `https://www.fiverr.com/inbox/contacts?older_than=${olderThan}`
        : 'https://www.fiverr.com/inbox/contacts';
      
      console.log(`Fetching batch ${batchNumber}...`);
      
      // Update status in background
      ongoingProcesses.contacts.set(tabId, {
        status: 'running',
        progress: `Fetching batch ${batchNumber}...`,
        batch: batchNumber,
        percentComplete: estimatePercentComplete(allContacts.length, totalContactsEstimate),
        timestamp: Date.now()
      });
      
      // Send progress update
      chrome.runtime.sendMessage({
        type: 'CONTACTS_PROGRESS',
        message: `Fetching batch ${batchNumber}...`,
        batch: batchNumber,
        percentComplete: estimatePercentComplete(allContacts.length, totalContactsEstimate)
      });

      // Use executeScript to fetch from the tab's context
      const fetchResult = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: async (url) => {
          try {
            const response = await fetch(url, {
              headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
              },
              credentials: 'include'
            });
            
            if (!response.ok) {
              throw new Error(`Failed to fetch contacts: ${response.status} ${response.statusText}`);
            }
            
            return await response.json();
          } catch (error) {
            return { error: error.message };
          }
        },
        args: [url]
      });

      // Check for errors
      if (!fetchResult || fetchResult[0].result.error) {
        throw new Error(fetchResult[0].result.error || 'Failed to fetch contacts');
      }

      const contacts = fetchResult[0].result;
      
      if (!contacts || contacts.length === 0) {
        console.log('No more contacts found.');
        
        // Update status
        ongoingProcesses.contacts.set(tabId, {
          status: 'running',
          progress: 'No more contacts found.',
          percentComplete: 100,
          timestamp: Date.now()
        });
        
        // Send progress update
        chrome.runtime.sendMessage({
          type: 'CONTACTS_PROGRESS',
          message: 'No more contacts found.',
          percentComplete: 100
        });
        
        return null;
      }
      
      // Add contacts to our collection
      allContacts = [...allContacts, ...contacts];
      
      // Update our estimate of total contacts after first batch
      if (batchNumber === 1) {
        // Roughly estimate based on first batch size and a typical pattern
        totalContactsEstimate = contacts.length * 3; 
      } else if (contacts.length < 20) {
        // If we get a small batch, we're likely near the end
        totalContactsEstimate = allContacts.length + Math.floor(contacts.length / 2);
      }
      
      // Update storage with current total
      chrome.storage.local.set({ 
        allContacts: allContacts,
        lastContactsFetch: Date.now()
      });
      
      // Find the oldest timestamp
      const timestamps = contacts.map(c => c.recentMessageDate);
      oldestTimestamp = Math.min(...timestamps);
      
      console.log(`Batch ${batchNumber}: Found ${contacts.length} contacts (Total: ${allContacts.length})`);
      
      // Update status
      ongoingProcesses.contacts.set(tabId, {
        status: 'running',
        progress: `Batch ${batchNumber}: Found ${contacts.length} contacts (Total: ${allContacts.length})`,
        totalContacts: allContacts.length,
        batch: batchNumber,
        batchSize: contacts.length,
        percentComplete: estimatePercentComplete(allContacts.length, totalContactsEstimate),
        timestamp: Date.now()
      });
      
      // Send progress update
      chrome.runtime.sendMessage({
        type: 'CONTACTS_PROGRESS',
        message: `Batch ${batchNumber}: Found ${contacts.length} contacts (Total: ${allContacts.length})`,
        totalContacts: allContacts.length,
        batch: batchNumber,
        batchSize: contacts.length,
        percentComplete: estimatePercentComplete(allContacts.length, totalContactsEstimate)
      });

      batchNumber++;
      return oldestTimestamp;
    } catch (error) {
      console.error('Error fetching contacts:', error);
      
      // Update status
      ongoingProcesses.contacts.set(tabId, {
        status: 'error',
        error: error.message,
        progress: `Error in batch ${batchNumber}: ${error.message}`,
        timestamp: Date.now()
      });
      
      // Send progress update
      chrome.runtime.sendMessage({
        type: 'CONTACTS_PROGRESS',
        message: `Error in batch ${batchNumber}: ${error.message}`,
        isError: true
      });
      
      return null;
    }
  }
  
  // Helper to estimate completion percentage
  function estimatePercentComplete(currentCount, estimatedTotal) {
    if (estimatedTotal <= 0) return 10; // Default to 10% if we don't have an estimate yet
    const percent = Math.floor((currentCount / estimatedTotal) * 100);
    return Math.min(99, percent); // Cap at 99% until we're truly done
  }
  
  // First batch
  let nextTimestamp = await fetchContactsBatch();
  
  // Keep fetching while we have older messages
  while (nextTimestamp) {
    // Add a small delay to prevent rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
    nextTimestamp = await fetchContactsBatch(nextTimestamp);
  }

  // Update final status
  ongoingProcesses.contacts.set(tabId, {
    status: 'completed',
    message: `Completed! Total contacts found: ${allContacts.length}`,
    timestamp: Date.now()
  });

  // Send final results
  chrome.runtime.sendMessage({
    type: 'CONTACTS_FETCHED',
    data: allContacts,
    message: `Completed! Total contacts found: ${allContacts.length}`
  });
  
  return allContacts;
}

// Function to fetch custom package data for custom_package type messages
async function fetchCustomPackageBg(customPackageId, tabId) {
  try {
    const url = `https://www.fiverr.com/custom_package/${customPackageId}`;

    const fetchResult = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: async (url) => {
        try {
          const response = await fetch(url, {
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json'
            },
            credentials: 'include'
          });

          if (!response.ok) {
            throw new Error(`Failed to fetch custom package: ${response.status} ${response.statusText}`);
          }

          return await response.json();
        } catch (error) {
          return { error: error.message };
        }
      },
      args: [url]
    });

    if (!fetchResult || !fetchResult[0] || fetchResult[0].result.error) {
      const errorMsg = fetchResult && fetchResult[0] ? fetchResult[0].result.error : 'No result from executeScript';
      console.error(`[CustomOffer] Failed to fetch custom package ${customPackageId}: ${errorMsg}`);
      return null;
    }

    return fetchResult[0].result;
  } catch (error) {
    console.error(`[CustomOffer] Error fetching custom package ${customPackageId}:`, error);
    return null;
  }
}

// Function to fetch conversation data with pagination in background
async function fetchConversationBg(username, tabId) {
  try {
    console.log(`fetchConversationBg started for ${username}`);
    
    // Update process tracking
    ongoingProcesses.conversations.set(tabId, {
      status: 'running',
      progress: `Starting conversation extraction for ${username}...`,
      timestamp: Date.now()
    });
    
    let allMessages = [];
    let lastPage = false;
    let timestamp = null;
    let batchNumber = 1;
    let conversationId = null;
    let totalBatchesEstimate = 5; // Initial estimate

    while (!lastPage) {
      // Update status
      ongoingProcesses.conversations.set(tabId, {
        status: 'running',
        progress: `Fetching message batch ${batchNumber}...`,
        percentComplete: Math.min(95, Math.round((batchNumber / totalBatchesEstimate) * 100)),
        currentBatch: batchNumber,
        estimatedTotalBatches: totalBatchesEstimate,
        timestamp: Date.now()
      });
      
      // Send progress update
      chrome.runtime.sendMessage({
        type: 'EXTRACTION_PROGRESS',
        message: `Fetching message batch ${batchNumber}...`,
        percentComplete: Math.min(95, Math.round((batchNumber / totalBatchesEstimate) * 100)),
        currentBatch: batchNumber,
        estimatedTotalBatches: totalBatchesEstimate
      });

      // Build URL with timestamp if not first batch
      const url = timestamp 
        ? `https://www.fiverr.com/inbox/contacts/${username}/conversation?timestamp=${timestamp}`
        : `https://www.fiverr.com/inbox/contacts/${username}/conversation`;

      console.log(`Fetching from URL: ${url}`);
      
      // Use executeScript to fetch from the tab's context
      const fetchResult = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: async (url) => {
          try {
            const response = await fetch(url, {
              headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
              },
              credentials: 'include'
            });
            
            if (!response.ok) {
              throw new Error(`Failed to fetch conversation: ${response.status} ${response.statusText}`);
            }
            
            return await response.json();
          } catch (error) {
            return { error: error.message };
          }
        },
        args: [url]
      });

      // Check for errors
      if (!fetchResult || fetchResult[0].result.error) {
        throw new Error(fetchResult[0].result.error || 'Failed to fetch conversation');
      }

      const data = fetchResult[0].result;
      
      console.log(`Received batch ${batchNumber} with ${data.messages ? data.messages.length : 0} messages`);
      
      // Store conversation ID from first batch
      if (!conversationId) {
        conversationId = data.conversationId;
      }

      // Adjust our total batches estimate based on first batch response
      if (batchNumber === 1 && data.messages && data.messages.length > 0) {
        // Estimate based on typical message count
        const messagesPerBatch = data.messages.length;
        // Check if data has information about total message count
        if (data.totalMessages && data.totalMessages > 0) {
          totalBatchesEstimate = Math.ceil(data.totalMessages / messagesPerBatch);
        } else {
          // Make a guess based on first batch size
          totalBatchesEstimate = Math.max(5, Math.ceil(messagesPerBatch * 3 / messagesPerBatch));
        }
      }

      // Process messages in this batch
      const processedMessages = await Promise.all((data.messages || []).map(async message => ({
        ...message,
        formattedTime: await formatDate(message.createdAt),
        attachments: await Promise.all((message.attachments || []).map(async attachment => ({
          filename: attachment.file_name,
          downloadUrl: attachment.download_url,
          fileSize: attachment.file_size,
          contentType: attachment.content_type,
          created_at: attachment.created_at || message.createdAt,
          formattedTime: await formatDate(attachment.created_at || message.createdAt)
        }))),
        repliedToMessage: message.repliedToMessage ? {
          ...message.repliedToMessage,
          formattedTime: await formatDate(message.repliedToMessage.createdAt)
        } : null
      })));

      // Add messages to our collection
      allMessages = [...allMessages, ...processedMessages];

      // Update lastPage status
      lastPage = data.lastPage;

      // If not last page, get timestamp for next batch
      if (!lastPage && processedMessages.length > 0) {
        // Use the oldest message's timestamp for next batch
        timestamp = Math.min(...processedMessages.map(m => m.createdAt));
      }

      // Increment batch number
      batchNumber++;

      // Add a small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Fetch custom package data for custom_package type messages
    const customPackageMessages = allMessages.filter(m => m.type === 'custom_package' && m.customPackageId);
    if (customPackageMessages.length > 0) {
      console.log(`[CustomOffer] Fetching custom package data for ${customPackageMessages.length} custom offer message(s)`);
      for (const message of customPackageMessages) {
        message.customPackageData = await fetchCustomPackageBg(message.customPackageId, tabId);
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // Create final processed data
    const processedData = {
      username: username,
      currentUsername: username,
      conversationId: conversationId,
      messages: allMessages.sort((a, b) => a.createdAt - b.createdAt)
    };

    console.log(`Conversation fetched for ${username} with ${processedData.messages.length} messages`);

    // Generate markdown for display
    const markdown = await convertToMarkdownBg(processedData);

    // Store the complete conversation data
    chrome.storage.local.set({ 
      conversationData: processedData,
      markdownContent: markdown,
      jsonContent: processedData
    });

    // Update status as completed
    ongoingProcesses.conversations.set(tabId, {
      status: 'completed',
      message: `Conversation with ${username} extracted successfully!`,
      timestamp: Date.now()
    });

    // Notify popup about completion with username
    chrome.runtime.sendMessage({
      type: 'CONVERSATION_EXTRACTED',
      data: processedData,
      message: `Conversation with ${username} extracted successfully!`
    });

    // Return the processed data for the bulk export
    return processedData;

  } catch (error) {
    console.error('Error fetching conversation:', error);
    
    // Update status as error
    ongoingProcesses.conversations.set(tabId, {
      status: 'error',
      error: error.message,
      timestamp: Date.now()
    });
    
    // Send error message
    chrome.runtime.sendMessage({
      type: 'EXTRACTION_ERROR',
      error: error.message
    });
    
    throw error; // Re-throw the error so it can be caught by the caller
  }
}

// ========== END OF ADDED FUNCTIONS ==========

// Listen for navigation to Fiverr pages
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url?.includes('fiverr.com')) {
    console.log(`Injecting content script into tab ${tabId}`);
    // Inject content script
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content.js']
    }).then(() => {
      activeTabsWithContentScript.add(tabId);
      console.log(`Content script injected into tab ${tabId}`);
    }).catch(err => console.error('Failed to inject content script:', err));
  }
});

// Remove tab from tracking when closed
chrome.tabs.onRemoved.addListener((tabId) => {
  activeTabsWithContentScript.delete(tabId);
  ongoingProcesses.contacts.delete(tabId);
  ongoingProcesses.conversations.delete(tabId);
});

// Listen for messages from popup or content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Background script received message:', request.type);
  const tabId = sender.tab ? sender.tab.id : (request.tabId || null);

  // Handle FETCH_CONVERSATION_FOR_EXPORT_RESPONSE from content script (keeping for backward compatibility)
  if (request.type === 'FETCH_CONVERSATION_FOR_EXPORT_RESPONSE') {
    console.log('Received export response from content script (legacy mode):', request);
    
    // Forward the response to the popup (in case it's still open)
    chrome.runtime.sendMessage(request);
    return true;
  }

  // Handle START_BULK_EXPORT request from popup
  if (request.type === 'START_BULK_EXPORT') {
    console.log('Starting bulk export process:', request);
    
    // Initialize the bulk export state
    ongoingProcesses.bulkExport = {
      status: 'running',
      progress: 0,
      total: request.contacts.length,
      completed: 0,
      failed: 0,
      current: null,
      message: 'Starting bulk export...',
      contacts: request.contacts,
      format: request.format,
      includeAttachments: request.includeAttachments,
      conversations: [],
      startTime: Date.now(),
      timestamp: Date.now(),
      tabId: request.tabId
    };
    
    // Start the bulk export process
    startBulkExportProcess(request.tabId);
    
    // Send immediate response
    sendResponse({ success: true, message: 'Bulk export started' });
    return true;
  }

  // Handle GET_BULK_EXPORT_STATUS request from popup
  if (request.type === 'GET_BULK_EXPORT_STATUS') {
    console.log('Sending bulk export status to popup');
    sendResponse(ongoingProcesses.bulkExport);
    return true;
  }

  if (request.type === 'INIT_POPUP') {
    // Inject content script when popup is opened
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      if (tab.url.includes('fiverr.com')) {
        try {
          console.log(`Injecting content script into active tab ${tab.id}`);
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
          });
          console.log(`Content script injected into active tab ${tab.id}`);
        } catch (error) {
          console.error('Failed to inject content script:', error);
        }
      }
    });
  }

  // Track process status updates
  else if (request.type === 'CONTACTS_PROGRESS' || request.type === 'EXTRACTION_PROGRESS') {
    if (tabId) {
      const processType = request.type === 'CONTACTS_PROGRESS' ? 'contacts' : 'conversations';
      ongoingProcesses[processType].set(tabId, {
        status: 'running',
        progress: request.message,
        timestamp: Date.now()
      });
    }
  }
  // Handle process completion
  else if (request.type === 'CONTACTS_FETCHED' || request.type === 'CONVERSATION_EXTRACTED') {
    if (tabId) {
      const processType = request.type === 'CONTACTS_FETCHED' ? 'contacts' : 'conversations';
      ongoingProcesses[processType].set(tabId, {
        status: 'completed',
        message: request.message,
        timestamp: Date.now()
      });
    }
  }
  // Handle errors
  else if (request.type === 'EXTRACTION_ERROR') {
    if (tabId) {
      ongoingProcesses.conversations.set(tabId, {
        status: 'error',
        error: request.error,
        timestamp: Date.now()
      });
    }
  }
  // Handle popup requesting status
  else if (request.type === 'GET_PROCESS_STATUS') {
    if (tabId) {
      const status = {
        contacts: ongoingProcesses.contacts.get(tabId),
        conversations: ongoingProcesses.conversations.get(tabId)
      };
      sendResponse(status);
      return true; // Keep message channel open for async response
    }
  }
  // Forward process requests to content script
  else if (['EXTRACT_CONVERSATION', 'FETCH_ALL_CONTACTS', 'FETCH_CONVERSATION_FOR_EXPORT'].includes(request.type)) {
    console.log(`Processing ${request.type} request in background`);
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (tab && tab.url && tab.url.includes('fiverr.com')) {
        // Handle different request types
        if (request.type === 'EXTRACT_CONVERSATION') {
          // Get username from storage
          chrome.storage.local.get(['currentUsername'], function(result) {
            if (result.currentUsername) {
              // Call our background function instead of forwarding to content script
              fetchConversationBg(result.currentUsername, tab.id);
            } else {
              // Update status with error
              ongoingProcesses.conversations.set(tab.id, {
                status: 'error',
                error: 'No username found for conversation extraction.',
          timestamp: Date.now()
        });
        
              // Send error message
              chrome.runtime.sendMessage({
                type: 'EXTRACTION_ERROR',
                error: 'No username found for conversation extraction.'
              });
      }
    });
  }
        else if (request.type === 'FETCH_ALL_CONTACTS') {
          // Call our background function instead of forwarding to content script
          fetchAllContactsBg(tab.id);
        }
        else if (request.type === 'FETCH_CONVERSATION_FOR_EXPORT') {
          // For individual message export requests (outside bulk export)
          // we'll handle them using our background function now
          if (request.username) {
            console.log(`Processing conversation export for ${request.username} in background`);
            try {
              fetchConversationBg(request.username, tab.id)
                .then(data => {
                  sendResponse({
                    success: true,
                    username: request.username,
                    data: data,
                    status: 'completed'
                  });
                })
                .catch(error => {
                  console.error(`Error fetching conversation for ${request.username}:`, error);
                  sendResponse({
                    success: false,
                    username: request.username,
                    error: error.message || 'Unknown error'
                  });
                });
            } catch (error) {
              console.error(`Error initiating conversation fetch for ${request.username}:`, error);
              sendResponse({
                success: false,
                username: request.username,
                error: error.message || 'Unknown error'
              });
            }
          } else {
            console.error('No username provided for FETCH_CONVERSATION_FOR_EXPORT');
            sendResponse({
              success: false,
              message: 'No username provided'
            });
          }
          
          // Return true to indicate we'll send a response asynchronously
          return true;
        }
      } else {
        console.error('No active Fiverr tab found');
        
        if (request.type === 'FETCH_ALL_CONTACTS') {
          chrome.runtime.sendMessage({
            type: 'CONTACTS_PROGRESS',
            message: 'No active Fiverr tab found. Please open Fiverr in a tab.',
            isError: true
          });
        } 
        else if (request.type === 'EXTRACT_CONVERSATION') {
          chrome.runtime.sendMessage({
            type: 'EXTRACTION_ERROR',
            error: 'No active Fiverr tab found. Please open Fiverr in a tab.'
          });
        }
        else if (request.type === 'FETCH_CONVERSATION_FOR_EXPORT') {
          sendResponse({
            success: false,
            message: 'No active Fiverr tab found. Please open Fiverr in a tab.'
          });
          return true;
        }
      }
    });
    
    // Return true for FETCH_CONVERSATION_FOR_EXPORT to keep the message channel open
    if (request.type === 'FETCH_CONVERSATION_FOR_EXPORT') {
      return true;
    }
  }

  // Add this new case
  else if (request.type === 'CONVERT_FORMATS') {
    if (request.data) {
      Promise.all([
        convertToMarkdownBg(request.data),
        convertToHtmlBg(request.data)
      ])
      .then(([markdown, html]) => {
        sendResponse({
          success: true,
          markdown: markdown,
          html: html
        });
      })
      .catch(error => {
        console.error('Error converting formats:', error);
        sendResponse({
          success: false,
          error: error.message
        });
      });
      
      return true; // Indicate async response
    } else {
      sendResponse({
        success: false,
        error: 'No data provided for conversion'
      });
    }
  }

  // Handle download all attachments as ZIP
  else if (request.type === 'DOWNLOAD_ALL_ATTACHMENTS_ZIP') {
    console.log('Received DOWNLOAD_ALL_ATTACHMENTS_ZIP request');
    downloadAllAttachmentsZip(request.username, request.attachments);
    sendResponse({ success: true });
    return true;
  }

  // Handle download conversation + attachments as ZIP
  else if (request.type === 'DOWNLOAD_CONVERSATION_WITH_ATTACHMENTS_ZIP') {
    console.log('Received DOWNLOAD_CONVERSATION_WITH_ATTACHMENTS_ZIP request');
    downloadConversationWithAttachmentsZip(request.username, request.format, request.includeAttachments);
    sendResponse({ success: true });
    return true;
  }
});

// Function to start the bulk export process
async function startBulkExportProcess(tabId) {
  console.log('Background: Starting bulk export process');
  
  try {
    // Validate the tab ID
    const tab = await chrome.tabs.get(tabId);
    if (!tab || !tab.url || !tab.url.includes('fiverr.com')) {
      throw new Error('Invalid tab or not a Fiverr page');
    }
    
    // Ensure we have valid data to process
    const bulkExport = ongoingProcesses.bulkExport;
    if (!bulkExport || !bulkExport.contacts || !Array.isArray(bulkExport.contacts) || bulkExport.contacts.length === 0) {
      throw new Error('No contacts selected for export');
    }
    
    // Update status
    updateBulkExportStatus('Preparing export...');
    
    // Inject content script if not already injected
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['content.js']
      });
      console.log('Content script injected successfully');
    } catch (error) {
      console.log('Content script already injected or injection failed:', error);
      // Continue anyway as the script might already be injected
    }
    
    // Start processing contacts one by one
    processNextContact(tabId);
  } catch (error) {
    console.error('Error starting bulk export:', error);
    updateBulkExportStatus(`Error: ${error.message}`, 'error');
  }
}

// Function to process the next contact in the queue
function processNextContact(tabId) {
  const bulkExport = ongoingProcesses.bulkExport;
  
  // If the export is no longer running, stop
  if (bulkExport.status !== 'running') {
    return;
  }
  
  // Get the next contact to process
  const contactIndex = bulkExport.completed + bulkExport.failed;
  if (contactIndex >= bulkExport.contacts.length) {
    // All contacts processed, finalize the export
    finalizeBulkExport();
    return;
  }
  
  const contact = bulkExport.contacts[contactIndex];
  bulkExport.current = contact.username;
  
  // Update status
  updateBulkExportStatus(`Exporting conversation ${contactIndex + 1} of ${bulkExport.total}: ${contact.username}`);
  
  // Use our background function directly instead of sending a message to content script
  console.log(`Starting background fetch for ${contact.username}`);
  fetchConversationBg(contact.username, tabId)
    .then(data => {
      // Process the response directly
      processConversationData(contact.username, data);
    })
    .catch(error => {
      console.error(`Error fetching conversation for ${contact.username}:`, error);
      
      // Add to failed conversations
      bulkExport.conversations.push({
        username: contact.username,
        success: false,
        error: error.message || 'Unknown error'
      });
      
      bulkExport.failed++;
      
      // Update progress
      bulkExport.progress = Math.round(((bulkExport.completed + bulkExport.failed) / bulkExport.total) * 100);
      
      // Broadcast progress update
      chrome.runtime.sendMessage({
        type: 'BULK_EXPORT_PROGRESS',
        progress: bulkExport.progress,
        completed: bulkExport.completed,
        failed: bulkExport.failed,
        total: bulkExport.total,
        current: bulkExport.current
      });
      
      // Process next contact
      processNextContact(tabId);
    });
}

// Function to process conversation data for bulk export
async function processConversationData(username, data) {
  const bulkExport = ongoingProcesses.bulkExport;
  
  try {
    let processed = false;
    
    if (data) {
      console.log(`Processing conversation data for ${username}`);
      
      const format = bulkExport.format;

      // Normalize the requested format(s) into an array of individual formats.
      // Accepts either an array (from the panel checkboxes) or a legacy string
      // value such as 'all', 'both', or a single format name.
      let formats;
      if (Array.isArray(format)) {
        formats = format;
      } else if (format === 'all') {
        formats = ['markdown', 'json', 'html'];
      } else if (format === 'both') {
        formats = ['markdown', 'json'];
      } else if (format) {
        formats = [format];
      } else {
        formats = [];
      }

      // Add the currentUsername to the data object to ensure correct titles
      const processedData = {
        ...data,
        currentUsername: username
      };

      // Process the conversation data and download directly
      try {
        // Create folder structure
        const folderPrefix = `fiverr-conversations/${username}`;

        // Track all download promises
        const downloadPromises = [];

        // Process markdown if needed
        if (formats.includes('markdown')) {
          // Convert to markdown
          const markdownContent = await convertToMarkdownBg(processedData);
          
          // Download the markdown file
          const mdFilename = `${folderPrefix}/${username}.md`;
          downloadPromises.push(downloadTextFile(markdownContent, mdFilename, 'text/markdown'));
        }
        
        // Process JSON if needed
        if (formats.includes('json')) {
          // Download the JSON file
          const jsonFilename = `${folderPrefix}/${username}.json`;
          downloadPromises.push(downloadTextFile(JSON.stringify(processedData, null, 2), jsonFilename, 'application/json'));
        }

        // Process HTML if needed
        if (formats.includes('html')) {
          // Convert to HTML
          const htmlContent = await convertToHtmlBg(processedData);

          // Download the HTML file
          const htmlFilename = `${folderPrefix}/${username}.html`;
          downloadPromises.push(downloadTextFile(htmlContent, htmlFilename, 'text/html'));
        }

        // Process attachments if needed
        if (bulkExport.includeAttachments && data.messages) {
          // For each message that has attachments
          for (const message of data.messages) {
            if (message.attachments && message.attachments.length > 0) {
              for (const attachment of message.attachments) {
                if (attachment.downloadUrl) {
                  const downloadPromise = new Promise((resolve, reject) => {
                    const filename = attachment.filename || 
                                   attachment.file_name || 
                                   attachment.name || 
                                   attachment.downloadUrl.split('/').pop() || 
                                   `attachment-${Date.now()}`;
                    
                    chrome.downloads.download({
                      url: attachment.downloadUrl,
                      filename: `${folderPrefix}/attachments/${filename}`,
                      conflictAction: 'uniquify'
                    }, (downloadId) => {
                      if (chrome.runtime.lastError) {
                        console.error(`Error downloading attachment: ${chrome.runtime.lastError.message}`);
                        reject(new Error(`Download error: ${chrome.runtime.lastError.message}`));
                      } else {
                        resolve(downloadId);
                      }
                    });
                  });
                  
                  downloadPromises.push(downloadPromise);
                }
              }
            }
          }
        }
        
        // Wait for all downloads to complete
        await Promise.all(downloadPromises);
        
        // Count this as ONE successful conversation regardless of format
        bulkExport.conversations.push({
          username: username,
          success: true
        });
        
        bulkExport.completed++;
        processed = true;
      } catch (error) {
        console.error(`Error processing files for ${username}:`, error);
        
        // Add to failed conversations
        bulkExport.conversations.push({
          username: username,
          success: false,
          error: error.message
        });
        
        bulkExport.failed++;
        processed = true;
      }
    } else {
      console.error(`No data received for ${username}`);
      
      // Add to failed conversations
      bulkExport.conversations.push({
        username: username,
        success: false,
        error: 'No conversation data received'
      });
      
      bulkExport.failed++;
      processed = true;
    }
    
    // Update progress
    bulkExport.progress = Math.round(((bulkExport.completed + bulkExport.failed) / bulkExport.total) * 100);
    
    // Broadcast progress update
    chrome.runtime.sendMessage({
      type: 'BULK_EXPORT_PROGRESS',
      progress: bulkExport.progress,
      completed: bulkExport.completed,
      failed: bulkExport.failed,
      total: bulkExport.total,
      current: bulkExport.current
    });
    
    // Process the next contact
    processNextContact(bulkExport.tabId);
  } catch (error) {
    console.error('Error processing conversation data:', error);
    bulkExport.failed++;
    
    // Process the next contact despite the error
    processNextContact(bulkExport.tabId);
  }
}

// Function to process the response from a fetch conversation request
async function processBulkExportResponse(response) {
  const bulkExport = ongoingProcesses.bulkExport;
  
  // If export is no longer running, ignore
  if (bulkExport.status !== 'running') {
    return;
  }
  
  try {
    let processed = false;
    
    // Check if this is a successful response with conversation data
    if (response.success && response.data) {
      console.log(`Received conversation data for ${response.username}`);
      
      const format = bulkExport.format;

      // Normalize the requested format(s) into an array of individual formats.
      let formats;
      if (Array.isArray(format)) {
        formats = format;
      } else if (format === 'all') {
        formats = ['markdown', 'json', 'html'];
      } else if (format === 'both') {
        formats = ['markdown', 'json'];
      } else if (format) {
        formats = [format];
      } else {
        formats = [];
      }

      // Add the currentUsername to the data object to ensure correct titles
      const processedData = {
        ...response.data,
        currentUsername: response.username
      };

      // Process the conversation data and download directly
      try {
        // Create folder structure
        const folderPrefix = `fiverr-conversations/${response.username}`;

        // Track all download promises
        const downloadPromises = [];

        // Process markdown if needed
        if (formats.includes('markdown')) {
          // Convert to markdown
          const markdownContent = await convertToMarkdownBg(processedData);

          // Download the markdown file
          const mdFilename = `${folderPrefix}/${response.username}.md`;
          downloadPromises.push(downloadTextFile(markdownContent, mdFilename, 'text/markdown'));
        }

        // Process JSON if needed
        if (formats.includes('json')) {
          // Download the JSON file
          const jsonFilename = `${folderPrefix}/${response.username}.json`;
          downloadPromises.push(downloadTextFile(JSON.stringify(response.data, null, 2), jsonFilename, 'application/json'));
        }

        // Process HTML if needed
        if (formats.includes('html')) {
          // Convert to HTML
          const htmlContent = await convertToHtmlBg(processedData);

          // Download the HTML file
          const htmlFilename = `${folderPrefix}/${response.username}.html`;
          downloadPromises.push(downloadTextFile(htmlContent, htmlFilename, 'text/html'));
        }
        
        // Process attachments if needed
        if (bulkExport.includeAttachments && response.data.messages) {
          downloadPromises.push(downloadAttachmentsDirectly(response.data, response.username, folderPrefix));
        }
        
        // Wait for all downloads to complete
        await Promise.all(downloadPromises);
        
        // Count this as ONE successful conversation regardless of format
        bulkExport.conversations.push({
          username: response.username,
          success: true
        });
        
        bulkExport.completed++;
        processed = true;
      } catch (error) {
        console.error(`Error processing files for ${response.username}:`, error);
        
        // Add to failed conversations
        bulkExport.conversations.push({
          username: response.username,
          success: false,
          error: error.message
        });
        
        bulkExport.failed++;
        processed = true;
      }
    } else if (response.error) {
      console.error(`Error exporting conversation for ${response.username}:`, response.error);
      
      // Add to failed conversations
      bulkExport.conversations.push({
        username: response.username,
        success: false,
        error: response.error
      });
      
      bulkExport.failed++;
      processed = true;
    }
    
    // Only process next if this response was successfully handled
    if (processed) {
      // Update progress
      bulkExport.progress = Math.round(((bulkExport.completed + bulkExport.failed) / bulkExport.total) * 100);
      
      // Broadcast progress update
      chrome.runtime.sendMessage({
        type: 'BULK_EXPORT_PROGRESS',
        progress: bulkExport.progress,
        completed: bulkExport.completed,
        failed: bulkExport.failed,
        total: bulkExport.total,
        current: bulkExport.current
      });
      
      // Process the next contact
      processNextContact(bulkExport.tabId);
    }
  } catch (error) {
    console.error('Error processing export response:', error);
    bulkExport.failed++;
    
    // Process the next contact despite the error
    processNextContact(bulkExport.tabId);
  }
}

// Helper function to download a text file directly
async function downloadTextFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);

  return new Promise((resolve, reject) => {
    chrome.downloads.download({
      url: url,
      filename: filename,
      conflictAction: 'uniquify'
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        URL.revokeObjectURL(url);
        reject(new Error(`Download error: ${chrome.runtime.lastError.message}`));
      } else {
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        resolve(downloadId);
      }
    });
  });
}

// Helper function to download attachments directly
async function downloadAttachmentsDirectly(conversation, username, folderPrefix) {
  if (!conversation || !conversation.messages) return;
  
  const attachmentPromises = [];
  let attachmentsCount = 0;
  
  // Process each message for attachments
  for (const message of conversation.messages) {
    if (message.attachments && message.attachments.length > 0) {
      for (const attachment of message.attachments) {
        if (attachment.downloadUrl) {
          attachmentsCount++;
          console.log(`Processing attachment ${attachmentsCount} for ${username}:`, attachment);
          
          const promise = fetch(attachment.downloadUrl)
            .then(response => {
              if (!response.ok) throw new Error(`Failed to fetch attachment: ${response.statusText}`);
              return response.blob();
            })
            .then(blob => {
              // Create a safe filename using the correct property
              const filename = attachment.filename || 
                             attachment.file_name || 
                             attachment.name || 
                             attachment.downloadUrl.split('/').pop() || 
                             `attachment-${Date.now()}`;
              
              // Create a safe path
              const safePath = `${folderPrefix}/attachments/${filename}`.replace(/[<>:"/\\|?*]/g, '_');
              
              // Create an object URL and download
              return new Promise((resolve, reject) => {
                const blobUrl = URL.createObjectURL(blob);
                chrome.downloads.download({
                  url: blobUrl,
                  filename: safePath,
                  conflictAction: 'uniquify'
                }, (downloadId) => {
                  if (chrome.runtime.lastError) {
                    URL.revokeObjectURL(blobUrl);
                    console.error(`Error downloading attachment: ${chrome.runtime.lastError.message}`);
                    reject(new Error(`Download error: ${chrome.runtime.lastError.message}`));
                  } else {
                    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
                    resolve(downloadId);
                  }
                });
              });
            })
            .catch(error => {
              console.error(`Error processing attachment for ${username}:`, error);
            });
          
          attachmentPromises.push(promise);
        }
      }
    }
  }
  
  // Wait for all attachment downloads to complete
  if (attachmentPromises.length > 0) {
    updateBulkExportStatus(`Downloading ${attachmentPromises.length} attachments for ${username}...`);
    await Promise.allSettled(attachmentPromises);
    console.log(`Completed downloading ${attachmentPromises.length} attachments for ${username}`);
  }
  
  return attachmentsCount;
}

// Function to finalize the bulk export
async function finalizeBulkExport() {
  const bulkExport = ongoingProcesses.bulkExport;
  
  try {
    // Ensure the completed count doesn't exceed the total
    if (bulkExport.completed > bulkExport.total) {
      console.warn(`Count mismatch detected: completed (${bulkExport.completed}) > total (${bulkExport.total}). Fixing count.`);
      bulkExport.completed = bulkExport.total;
    }
    
    // Deduplicate the conversations array based on username
    const uniqueUsernames = new Set();
    const uniqueConversations = [];
    
    for (const conv of bulkExport.conversations) {
      if (!uniqueUsernames.has(conv.username)) {
        uniqueUsernames.add(conv.username);
        uniqueConversations.push(conv);
      }
    }
    
    // Update with deduplicated list
    bulkExport.conversations = uniqueConversations;
    
    // Set the completed count based on unique successful conversations
    const successfulConversations = uniqueConversations.filter(conv => conv.success).length;
    bulkExport.completed = successfulConversations;
    
    // Update status to completed
    updateBulkExportStatus(`Export completed. Downloaded ${bulkExport.completed} conversations to individual folders.`, 'completed');
    
    // Create a summary file with export details
    const timestamp = new Date().toISOString().replace(/[:T]/g, '-').split('.')[0];
    const summary = {
      timestamp: timestamp,
      completed: bulkExport.completed,
      failed: bulkExport.conversations.filter(conv => !conv.success).length,
      total: bulkExport.total,
      format: bulkExport.format,
      includeAttachments: bulkExport.includeAttachments,
      conversations: bulkExport.conversations
    };
    
    // Download the summary file
    await downloadTextFile(
      JSON.stringify(summary, null, 2),
      `fiverr-conversations/export-summary-${timestamp}.json`,
      'application/json'
    );
    
    console.log('Export completed successfully:', summary);
  } catch (error) {
    console.error('Error finalizing bulk export:', error);
    updateBulkExportStatus(`Error finalizing export: ${error.message}`, 'error');
  }
}

// Helper function to convert ArrayBuffer to base64
function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Function to update the bulk export status
function updateBulkExportStatus(message, status = null) {
  // Get a reference to the bulk export state
  const bulkExport = ongoingProcesses.bulkExport;
  
  // If there's no ongoing export, just log the message
  if (!bulkExport) {
    console.log('No ongoing bulk export to update status for:', message);
    return;
  }
  
  // Update status if provided
  if (status) {
    bulkExport.status = status;
    
    // Set timestamp when status changes
    if (status === 'completed' || status === 'error') {
      bulkExport.timestamp = Date.now();
      
      // Log completion statistics
      console.log(`Bulk export ${status}: ${bulkExport.completed} completed, ${bulkExport.failed} failed out of ${bulkExport.total}`);
    }
  }
  
  // Update message
  bulkExport.message = message;
  
  // Validate that completed + failed doesn't exceed total
  if (bulkExport.completed + bulkExport.failed > bulkExport.total) {
    console.warn('Export counting error detected. Fixing counts.');
    // If we somehow have more completed+failed than total, adjust the completed count
    // This can happen if we accidentally count formats separately
    bulkExport.completed = Math.max(0, bulkExport.total - bulkExport.failed);
  }
  
  // Recalculate progress
  bulkExport.progress = Math.round(((bulkExport.completed + bulkExport.failed) / bulkExport.total) * 100);
  
  // Send status update to popup
  chrome.runtime.sendMessage({
    type: 'BULK_EXPORT_STATUS',
    status: bulkExport.status,
    progress: bulkExport.progress,
    completed: bulkExport.completed,
    failed: bulkExport.failed,
    total: bulkExport.total,
    current: bulkExport.current,
    message: message,
    timestamp: bulkExport.timestamp
  });
}

// Helper function to format dates consistently
function formatDate(timestamp) {
  try {
    let date;
    
    // Handle different timestamp formats
    if (!timestamp) {
      return 'Unknown Date';
    }
    
    // Try to parse as milliseconds since epoch (number or string)
    if (!isNaN(Number(timestamp))) {
      date = new Date(Number(timestamp));
    } else {
      // Try to parse as ISO string or other date format
      date = new Date(timestamp);
    }
    
    // Check if date is valid
    if (isNaN(date.getTime())) {
      return 'Unknown Date';
    }
    
    // Format the date consistently
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    const time = date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit', 
      second: '2-digit', 
      hour12: true 
    });
    
    // Use a consistent format (DD/MM/YYYY)
    return `${day}/${month}/${year}, ${time}`;
  } catch (e) {
    console.warn('Error formatting date:', e, timestamp);
    return 'Unknown Date';
  }
}

// Helper function to convert conversation data to markdown
async function convertToMarkdown(data) {
  try {
    if (!data || !data.messages) {
      return '# Conversation Export\n\nNo messages found.';
    }
    
    let markdown = `# Conversation with ${data.username}\n\n`;
    
    // Add timestamp
    markdown += `Exported on: ${formatDate(Date.now())}\n\n`;
    
    // Process each message
    for (const message of data.messages) {
      // Format the date using our helper function
      const timestampStr = formatDate(message.timestamp || message.createdAt);
      
      // Add sender info with formatting
      const sender = message.sender === 'buyer' ? 'You' : data.username;
      markdown += `## ${sender} (${timestampStr})\n\n`;
      
      // Add message text
      if (message.text || message.body) {
        markdown += `${message.text || message.body}\n\n`;
      }
      
      // Add attachments if present
      if (message.attachments && message.attachments.length > 0) {
        markdown += '**Attachments:**\n\n';
        for (const attachment of message.attachments) {
          const filename = attachment.filename || attachment.file_name || attachment.name || 'Attachment';
          markdown += `- ${filename}\n`;
        }
        markdown += '\n';
      }
    }
    
    return markdown;
  } catch (error) {
    console.error('Error converting to markdown:', error);
    return `# Error in Conversion\n\nAn error occurred: ${error.message}`;
  }
}

// Helper function to process attachments for export
async function processAttachmentsForExport(conversation, username, zipFolder) {
  if (!conversation || !conversation.messages) return;
  
  const attachmentPromises = [];
  
  // Process each message for attachments
  for (const message of conversation.messages) {
    if (message.attachments && message.attachments.length > 0) {
      for (const attachment of message.attachments) {
        if (attachment.downloadUrl) {
          console.log(`Processing attachment for ${username}:`, attachment);
          const promise = fetch(attachment.downloadUrl)
            .then(response => {
              if (!response.ok) throw new Error(`Failed to fetch attachment: ${response.statusText}`);
              return response.blob();
            })
            .then(blob => {
              // Create a safe filename using the correct property
              const filename = attachment.filename || 
                             attachment.file_name || 
                             attachment.downloadUrl.split('/').pop() || 
                             `attachment-${Date.now()}`;
              
              // Add to zip in a folder structure by username
              const safePath = `${username}/${filename}`.replace(/[<>:"/\\|?*]/g, '_');
              console.log(`Adding attachment to zip: ${safePath}`);
              zipFolder.file(safePath, blob);
            })
            .catch(error => {
              console.error(`Error processing attachment for ${username}:`, error);
            });
          
          attachmentPromises.push(promise);
        }
      }
    }
  }
  
  // Wait for all attachment downloads to complete
  if (attachmentPromises.length > 0) {
    updateBulkExportStatus(`Downloading ${attachmentPromises.length} attachments for ${username}...`);
    await Promise.allSettled(attachmentPromises);
  }
}

// Helper function to convert a blob to a chunked data URL
async function blobToChunkedDataUrl(blob) {
  // Split the blob into manageable chunks
  const CHUNK_SIZE = 1024 * 1024; // 1MB chunks for processing
  const chunks = Math.ceil(blob.size / CHUNK_SIZE);
  let base64Data = '';
  
  for (let i = 0; i < chunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, blob.size);
    const chunk = blob.slice(start, end);
    
    // Convert chunk to base64
    const arrayBuffer = await chunk.arrayBuffer();
    base64Data += arrayBufferToBase64(arrayBuffer);
  }
  
  return `data:application/zip;base64,${base64Data}`;
}

// Helper function to download using a data URL
function downloadWithDataUrl(dataUrl, filename) {
  chrome.downloads.download({
    url: dataUrl,
    filename: filename,
    saveAs: true
  }, (downloadId) => {
    if (chrome.runtime.lastError) {
      console.error('Download error:', chrome.runtime.lastError);
      updateBulkExportStatus(`Error downloading: ${chrome.runtime.lastError.message}`, 'error');
    } else {
      // Update status
      updateBulkExportStatus(`Export completed. Downloaded ${ongoingProcesses.bulkExport.completed} conversations.`, 'completed');
    }
  });
}

// Function to download all attachments as a single ZIP file
async function downloadAllAttachmentsZip(username, attachments) {
  try {
    if (typeof JSZip === 'undefined') {
      chrome.runtime.sendMessage({
        type: 'ATTACHMENT_ZIP_ERROR',
        message: 'JSZip is not available. Please ensure jszip.min.js is in the extension folder.'
      });
      return;
    }

    if (!attachments || attachments.length === 0) {
      chrome.runtime.sendMessage({
        type: 'ATTACHMENT_ZIP_ERROR',
        message: 'No attachments to download.'
      });
      return;
    }

    const zip = new JSZip();
    let successCount = 0;
    let failCount = 0;
    const total = attachments.length;

    for (let i = 0; i < attachments.length; i++) {
      const attachment = attachments[i];
      const filename = attachment.filename || `attachment_${i + 1}`;

      chrome.runtime.sendMessage({
        type: 'ATTACHMENT_ZIP_PROGRESS',
        current: i + 1,
        total: total,
        message: `Fetching attachment ${i + 1} of ${total}: ${filename}`
      });

      try {
        const response = await fetch(attachment.downloadUrl);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const blob = await response.blob();
        zip.file(`attachments/${filename}`, blob);
        successCount++;
      } catch (fetchError) {
        console.error(`Failed to fetch attachment ${filename}:`, fetchError);
        failCount++;
      }
    }

    chrome.runtime.sendMessage({
      type: 'ATTACHMENT_ZIP_PROGRESS',
      current: total,
      total: total,
      message: 'Creating ZIP file...'
    });

    const base64 = await zip.generateAsync({ type: 'base64' });
    const dataUrl = `data:application/zip;base64,${base64}`;

    chrome.downloads.download({
      url: dataUrl,
      filename: `${username}/${username}_attachments.zip`,
      conflictAction: 'uniquify'
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        chrome.runtime.sendMessage({
          type: 'ATTACHMENT_ZIP_ERROR',
          message: chrome.runtime.lastError.message
        });
      } else {
        let msg = `Attachments ZIP downloaded (${successCount} files`;
        if (failCount > 0) msg += `, ${failCount} failed`;
        msg += ').';
        chrome.runtime.sendMessage({
          type: 'ATTACHMENT_ZIP_COMPLETE',
          message: msg
        });
      }
    });

  } catch (error) {
    console.error('Error creating attachments ZIP:', error);
    chrome.runtime.sendMessage({
      type: 'ATTACHMENT_ZIP_ERROR',
      message: error.message || 'Failed to create attachments ZIP.'
    });
  }
}

// Function to download conversation + attachments as a single ZIP file
async function downloadConversationWithAttachmentsZip(username, format, includeAttachments = true) {
  try {
    if (typeof JSZip === 'undefined') {
      chrome.runtime.sendMessage({
        type: 'CONV_ZIP_ERROR',
        message: 'JSZip is not available. Please ensure jszip.min.js is in the extension folder.'
      });
      return;
    }

    // Read conversation data from storage
    const result = await chrome.storage.local.get(['conversationData']);
    const data = result.conversationData;

    if (!data || !data.messages) {
      chrome.runtime.sendMessage({
        type: 'CONV_ZIP_ERROR',
        message: 'No conversation data found. Please extract a conversation first.'
      });
      return;
    }

    const processedData = { ...data, currentUsername: username };
    const zip = new JSZip();

    // Normalize the requested format(s) into an array of individual formats.
    // Accepts either an array (from the popup checkboxes) or a legacy string
    // value such as 'all', 'both', or a single format name.
    let formats;
    if (Array.isArray(format)) {
      formats = format;
    } else if (format === 'all') {
      formats = ['markdown', 'json', 'html'];
    } else if (format === 'both') {
      formats = ['markdown', 'json'];
    } else if (format) {
      formats = [format];
    } else {
      formats = [];
    }

    // Add format file(s) to the ZIP based on user's choice
    if (formats.includes('markdown')) {
      chrome.runtime.sendMessage({
        type: 'CONV_ZIP_PROGRESS',
        current: 0,
        total: 1,
        message: 'Generating Markdown...'
      });
      const markdown = await convertToMarkdownBg(processedData);
      zip.file(`${username}.md`, markdown);
    }

    if (formats.includes('json')) {
      zip.file(`${username}.json`, JSON.stringify(processedData, null, 2));
    }

    if (formats.includes('html')) {
      chrome.runtime.sendMessage({
        type: 'CONV_ZIP_PROGRESS',
        current: 0,
        total: 1,
        message: 'Generating HTML...'
      });
      const html = await convertToHtmlBg(processedData);
      zip.file(`${username}.html`, html);
    }

    // Collect and fetch attachments if requested
    let successCount = 0;
    let failCount = 0;
    let total = 0;

    if (includeAttachments) {
      // Collect all attachments from conversation messages
      let attachments = [];
      for (const message of data.messages) {
        if (message.attachments && message.attachments.length > 0) {
          for (const attachment of message.attachments) {
            if (attachment.downloadUrl) {
              attachments.push({
                downloadUrl: attachment.downloadUrl,
                filename: attachment.filename || attachment.file_name || `attachment_${attachments.length + 1}`
              });
            }
          }
        }
      }

      // Fetch and add each attachment to the ZIP
      total = attachments.length;

      for (let i = 0; i < attachments.length; i++) {
        const attachment = attachments[i];
        const filename = attachment.filename;

        chrome.runtime.sendMessage({
          type: 'CONV_ZIP_PROGRESS',
          current: i + 1,
          total: total,
          message: `Fetching attachment ${i + 1} of ${total}: ${filename}`
        });

        try {
          const response = await fetch(attachment.downloadUrl);
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          const blob = await response.blob();
          zip.file(`attachments/${filename}`, blob);
          successCount++;
        } catch (fetchError) {
          console.error(`Failed to fetch attachment ${filename}:`, fetchError);
          failCount++;
        }
      }
    }

    chrome.runtime.sendMessage({
      type: 'CONV_ZIP_PROGRESS',
      current: total > 0 ? total : 1,
      total: total > 0 ? total : 1,
      message: 'Creating ZIP file...'
    });

    const base64 = await zip.generateAsync({ type: 'base64' });
    const dataUrl = `data:application/zip;base64,${base64}`;

    chrome.downloads.download({
      url: dataUrl,
      filename: `${username}/${username}_conversation.zip`,
      conflictAction: 'uniquify'
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        chrome.runtime.sendMessage({
          type: 'CONV_ZIP_ERROR',
          message: chrome.runtime.lastError.message
        });
      } else {
        let msg = 'Conversation ZIP downloaded';
        if (total > 0) {
          msg += ` (${successCount} attachments`;
          if (failCount > 0) msg += `, ${failCount} failed`;
          msg += ')';
        }
        msg += '.';
        chrome.runtime.sendMessage({
          type: 'CONV_ZIP_COMPLETE',
          message: msg
        });
      }
    });

  } catch (error) {
    console.error('Error creating conversation ZIP:', error);
    chrome.runtime.sendMessage({
      type: 'CONV_ZIP_ERROR',
      message: error.message || 'Failed to create conversation ZIP.'
    });
  }
}
