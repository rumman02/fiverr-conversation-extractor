// Import formatDate function from content.js
async function formatDate(timestamp) {
  const date = new Date(parseInt(timestamp));
  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = date.getFullYear();
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
  
  // Get user's preferred format from storage
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

// Inline SVG icons (Lucide-style line icons) used in dynamic button labels
const ICONS = {
  users: '<svg class="btn-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  paperclip: '<svg class="btn-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>',
  calendar: '<svg class="calendar-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>'
};

function viewContactsLabel(count, hide) {
  return `${ICONS.users}${hide ? 'Hide' : 'View'} Contacts (<span id="contactsCountBadge">${count}</span>)`;
}

function viewAttachmentsLabel(count, hide) {
  return `${ICONS.paperclip}${hide ? 'Hide' : 'View'} Attachments (${count})`;
}

/**
 * Progress Bar Management
 */
function showProgressBar(isIndeterminate = false) {
  const container = document.getElementById('progressBarContainer');
  const bar = document.getElementById('progressBar');
  
  container.style.display = 'block';
  
  if (isIndeterminate) {
    bar.classList.add('indeterminate');
  } else {
    bar.classList.remove('indeterminate');
    updateProgress(0);
  }
}

function hideProgressBar() {
  const container = document.getElementById('progressBarContainer');
  container.style.display = 'none';
}

function updateProgress(percent, message = null) {
  const bar = document.getElementById('progressBar');
  const label = document.getElementById('progressLabel');
  
  if (bar.classList.contains('indeterminate')) {
    bar.classList.remove('indeterminate');
  }
  
  // Ensure percent is between 0 and 100
  percent = Math.max(0, Math.min(100, percent));
  
  bar.style.width = `${percent}%`;
  label.textContent = message || `${percent}%`;
}

/**
 * Notification System
 */
let notificationCounter = 0;
const activeNotifications = new Set();

// Add this function at the top to manage notifications
let activeNotificationsByType = {
  success: null,
  error: null,
  info: null
};

// Modified showNotification function to prevent duplicates
function showNotification(type, title, message, duration = 5000) {
  const container = document.getElementById('notificationContainer');
  
  // If there's already an active notification of this type, remove it first
  if (activeNotificationsByType[type]) {
    removeNotification(activeNotificationsByType[type]);
  }
  
  const id = `notification-${notificationCounter++}`;
  
  const notificationElement = document.createElement('div');
  notificationElement.className = `notification ${type}`;
  notificationElement.id = id;
  
  notificationElement.innerHTML = `
    <div class="notification-content">
      <div class="notification-title">${title}</div>
      <div class="notification-message">${message}</div>
    </div>
    <div class="notification-close" data-id="${id}">×</div>
    <div class="notification-progress"></div>
  `;
  
  container.appendChild(notificationElement);
  activeNotifications.add(id);
  activeNotificationsByType[type] = id;
  
  // Add event listener for close button
  const closeButton = notificationElement.querySelector('.notification-close');
  closeButton.addEventListener('click', function() {
    removeNotification(id);
  });
  
  // Auto-remove after duration
  if (duration > 0) {
    setTimeout(() => {
      if (activeNotifications.has(id)) {
        removeNotification(id);
      }
    }, duration);
  }
  
  return id;
}

// Modified removeNotification function to update the tracking
function removeNotification(id) {
  const notification = document.getElementById(id);
  if (notification) {
    notification.style.opacity = '0';
    notification.style.transform = 'translateX(100%)';
    
    // Remove the reference from activeNotificationsByType
    for (const type in activeNotificationsByType) {
      if (activeNotificationsByType[type] === id) {
        activeNotificationsByType[type] = null;
      }
    }
    
    // Remove after animation
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
      activeNotifications.delete(id);
    }, 300);
  }
}

// Modified updateStatus to NOT show notifications automatically
function updateStatus(message, isError = false, isProgress = false) {
  const statusDiv = document.getElementById('status');
  statusDiv.textContent = message;
  statusDiv.className = `status ${isError ? 'error' : isProgress ? 'progress' : 'success'}`;
  
  // Show/hide progress bar based on status
  if (isProgress) {
    showProgressBar(true); // Show indeterminate progress bar
  } else {
    hideProgressBar();
  }
  
  // We removed the automatic notification creation here
}

// Format file size
function formatFileSize(bytes) {
  if (!bytes || isNaN(bytes)) return 'size unknown';
  if (bytes < 1024) return bytes + ' B';
  else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  else return (bytes / 1048576).toFixed(1) + ' MB';
}

// Add log entry
function addLogEntry(message, isError = false) {
  const progressLog = document.getElementById('progressLog');
  const logEntry = document.createElement('div');
  logEntry.className = `log-entry${isError ? ' error' : ''}`;
  logEntry.textContent = message;
  progressLog.appendChild(logEntry);
  progressLog.scrollTop = progressLog.scrollHeight;
}

// Update contact counter
function updateContactCounter(count) {
  const contactCount = document.getElementById('contactCount');
  const progressCounter = document.getElementById('progressCounter');
  if (contactCount && progressCounter) {
    contactCount.textContent = count;
    progressCounter.style.display = 'block';
    
    // Update storage with latest count
    chrome.storage.local.set({ lastContactCount: count });
  }
}

// Add a global variable to track selected attachments
let selectedAttachments = new Set();

// Update the panel management functions
function closeAllPanels() {
  const panels = document.querySelectorAll('.side-panel');
  panels.forEach(panel => panel.classList.remove('expanded'));
  document.querySelector('.main-container').classList.remove('expanded');
  
  // Reset button texts
  const contactsBtn = document.getElementById('toggleContacts');
  const attachmentsBtn = document.getElementById('viewAttachmentsBtn');
  
  if (contactsBtn) {
    contactsBtn.innerHTML = viewContactsLabel(document.getElementById('contactsCount')?.textContent || '0');
  }

  if (attachmentsBtn) {
    const count = document.getElementById('attachmentsCount')?.textContent || '0';
    attachmentsBtn.innerHTML = viewAttachmentsLabel(count);
  }
}

function toggleContactsPanel() {
  const panel = document.getElementById('contactsPanel');
  const container = document.querySelector('.main-container');
  const toggleBtn = document.getElementById('toggleContacts');
  
  // Check if panel is already expanded
  const isCurrentlyExpanded = panel.classList.contains('expanded');
  
  // If it's expanded, just close it
  if (isCurrentlyExpanded) {
    panel.classList.remove('expanded');
    container.classList.remove('expanded');
    toggleBtn.innerHTML = viewContactsLabel(document.getElementById('contactsCount').textContent);
    return;
  }

  // Otherwise, close all panels first, then open this one
  closeAllPanels();

  // Now expand this panel
  panel.classList.add('expanded');
  container.classList.add('expanded');
  toggleBtn.innerHTML = viewContactsLabel(document.getElementById('contactsCount').textContent, true);
}

function toggleAttachmentsPanel() {
  const panel = document.getElementById('attachmentsPanel');
  const container = document.querySelector('.main-container');
  const toggleBtn = document.getElementById('viewAttachmentsBtn');
  
  // Check if panel is already expanded
  const isCurrentlyExpanded = panel.classList.contains('expanded');
  
  // If it's expanded, just close it
  if (isCurrentlyExpanded) {
    panel.classList.remove('expanded');
    container.classList.remove('expanded');
    const count = document.getElementById('attachmentsCount').textContent;
    toggleBtn.innerHTML = viewAttachmentsLabel(count);
    return;
  }

  // Otherwise, close all panels first, then open this one
  closeAllPanels();

  // Now expand this panel
  panel.classList.add('expanded');
  container.classList.add('expanded');
  const count = document.getElementById('attachmentsCount').textContent;
  toggleBtn.innerHTML = viewAttachmentsLabel(count, true);
}

// Modified displayAttachments function
async function displayAttachments(messages) {
  const attachmentsList = document.getElementById('attachmentsList');
  const attachmentsCount = document.getElementById('attachmentsCount');
  if (!attachmentsList || !attachmentsCount) return;
  
  attachmentsList.innerHTML = '';
  selectedAttachments.clear();
  updateSelectedCount();

  // Get current username and sort preference from storage
  chrome.storage.local.get(['currentUsername', 'attachmentSort'], async function(result) {
    const username = result.currentUsername;
    const sortOrder = result.attachmentSort || 'newest';
    let attachmentIndex = 0;
    
    // Create a flat list of all attachments with their message timestamps
    let allAttachments = [];
    for (const message of messages) {
      if (message.attachments && message.attachments.length > 0) {
        for (const attachment of message.attachments) {
          allAttachments.push({
            ...attachment,
            message_timestamp: message.createdAt || 0
          });
        }
      }
    }
    
    // Update attachments count
    attachmentsCount.textContent = allAttachments.length.toString();
    document.getElementById('viewAttachmentsBtn').innerHTML =
      viewAttachmentsLabel(allAttachments.length);
    
    // Sort the attachments based on user preference
    if (sortOrder === 'newest') {
      allAttachments.sort((a, b) => {
        const timeA = a.created_at || a.message_timestamp || 0;
        const timeB = b.created_at || b.message_timestamp || 0;
        return timeB - timeA; // Newest first
      });
    } else {
      allAttachments.sort((a, b) => {
        const timeA = a.created_at || a.message_timestamp || 0;
        const timeB = b.created_at || b.message_timestamp || 0;
        return timeA - timeB; // Oldest first
      });
    }
    
    // Display the sorted attachments
    for (const attachment of allAttachments) {
          const attachmentDiv = document.createElement('div');
          attachmentDiv.className = 'attachment-item';
      attachmentDiv.dataset.index = attachmentIndex++;
      
      // Create wrapper for checkbox and info
      const wrapper = document.createElement('div');
      wrapper.className = 'attachment-wrapper';
      
      // Add checkbox
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'attachment-checkbox';
      checkbox.dataset.url = attachment.downloadUrl;
      checkbox.dataset.filename = attachment.filename;
      
      // Handle checkbox change
      checkbox.addEventListener('change', function() {
        const itemDiv = this.closest('.attachment-item');
        
        if (this.checked) {
          selectedAttachments.add({
            url: this.dataset.url,
            filename: this.dataset.filename
          });
          itemDiv.classList.add('selected');
        } else {
          // Find and remove the attachment
          selectedAttachments.forEach(item => {
            if (item.url === this.dataset.url) {
              selectedAttachments.delete(item);
            }
          });
          itemDiv.classList.remove('selected');
        }
        
        updateSelectedCount();
      });
          
          const info = document.createElement('div');
          info.className = 'attachment-info';
          
          // Format the timestamp using the same function
          const timestamp = attachment.created_at ? await formatDate(attachment.created_at) : 'Time unknown';
          
          info.innerHTML = `
            <div class="attachment-name">${attachment.filename} (${formatFileSize(attachment.fileSize)})</div>
            <div class="attachment-time">${ICONS.calendar}${timestamp}</div>
          `;
          
          const downloadBtn = document.createElement('button');
          downloadBtn.className = 'download-btn';
          downloadBtn.textContent = 'Download';
          downloadBtn.onclick = () => {
            chrome.downloads.download({
              url: attachment.downloadUrl,
              filename: `${username}/attachments/${attachment.filename}`,
              saveAs: false
            });
          };

      // Append elements to the attachment div
      wrapper.appendChild(checkbox);
      wrapper.appendChild(info);
      attachmentDiv.appendChild(wrapper);
          attachmentDiv.appendChild(downloadBtn);
          attachmentsList.appendChild(attachmentDiv);
        }
    
    // Setup bulk actions after all attachments are displayed
    setupBulkActions(username);
  });
}

// Function to update the selected count display
function updateSelectedCount() {
  const countElement = document.getElementById('selectedCount');
  const bulkDownloadBtn = document.getElementById('bulkDownloadBtn');
  
  if (countElement && bulkDownloadBtn) {
    const count = selectedAttachments.size;
    countElement.textContent = count;
    
    // Enable/disable the bulk download button
    bulkDownloadBtn.disabled = count === 0;
  }
}

// Function to set up the bulk actions
function setupBulkActions(username) {
  // Select all attachments checkbox
  const selectAllCheckbox = document.getElementById('selectAllAttachments');
  
  selectAllCheckbox.addEventListener('change', function() {
    const checkboxes = document.querySelectorAll('.attachment-checkbox:not(#selectAllAttachments)');
    const items = document.querySelectorAll('.attachment-item');
    
    selectedAttachments.clear();
    
    checkboxes.forEach((checkbox, index) => {
      checkbox.checked = this.checked;
      
      if (this.checked) {
        items[index].classList.add('selected');
        selectedAttachments.add({
          url: checkbox.dataset.url,
          filename: checkbox.dataset.filename
        });
      } else {
        items[index].classList.remove('selected');
      }
    });
    
    updateSelectedCount();
  });
  
  // Bulk download button
  const bulkDownloadBtn = document.getElementById('bulkDownloadBtn');
  
  bulkDownloadBtn.addEventListener('click', function() {
    if (selectedAttachments.size === 0) return;
    
    // Download each selected attachment
    selectedAttachments.forEach(attachment => {
      chrome.downloads.download({
        url: attachment.url,
        filename: `${username}/attachments/${attachment.filename}`,
        saveAs: false
      });
    });
    
    // Show brief notification
    updateStatus(`Downloading ${selectedAttachments.size} attachments...`);
  });
}

// Modified displayContacts function
async function displayContacts(contacts) {
  const contactsList = document.getElementById('contactsList');
  const contactsCount = document.getElementById('contactsCount');
  const contactsCountBadge = document.getElementById('contactsCountBadge');
  if (!contactsList || !contactsCount) return;

  contactsList.innerHTML = ''; // Clear existing contacts
  
  if (!contacts || contacts.length === 0) {
    contactsList.innerHTML = '<div class="no-contacts">No contacts found</div>';
    contactsCount.textContent = '0';
    contactsCountBadge.textContent = '0';
    return;
  }

  const count = contacts.length.toString();
  contactsCount.textContent = count;
  contactsCountBadge.textContent = count;

  for (const contact of contacts) {
    const contactDiv = document.createElement('div');
    contactDiv.className = 'contact-item';
    
    const username = contact.username || 'Unknown User';
    const lastMessage = await formatDate(contact.recentMessageDate);
    
    contactDiv.innerHTML = `
      <div class="contact-name">${username}</div>
      <div class="contact-last-message">Last message: ${lastMessage}</div>
    `;
    
    contactDiv.addEventListener('click', () => {
      // Store username and trigger extraction
      chrome.storage.local.set({ currentUsername: username }, () => {
        // Only send message after storage is set
        chrome.runtime.sendMessage({ type: 'EXTRACT_CONVERSATION' });
        updateStatus(`Extracting conversation with ${username}...`, false, true);
        // Close the contacts panel after selection
        document.getElementById('contactsPanel').classList.remove('expanded');
        document.querySelector('.main-container').classList.remove('expanded');
        // Update button text
        document.getElementById('toggleContacts').innerHTML =
          viewContactsLabel(count);
      });
    });
    
    contactsList.appendChild(contactDiv);
  }
}

// Function to load stored contacts
function loadStoredContacts() {
  chrome.storage.local.get(['allContacts', 'lastContactsFetch', 'lastContactCount'], function(result) {
    if (result.allContacts && result.allContacts.length > 0) {
      displayContacts(result.allContacts).catch(console.error);
      
      // Use the actual contacts length for the counter
      updateContactCounter(result.allContacts.length);
      
      // Also populate the contacts for export when contacts are loaded
      populateContactsForExport();
      
      // Show last fetch time if available
      if (result.lastContactsFetch) {
        const lastFetch = new Date(result.lastContactsFetch).toLocaleString();
        const progressCounter = document.getElementById('progressCounter');
        if (progressCounter) {
          progressCounter.style.display = 'block';
          progressCounter.innerHTML = `Total Contacts: <span id="contactCount">${result.allContacts.length}</span><br>Last updated: ${lastFetch}`;
        }
      }
    }
  });
}

// Function to update last fetch time
function updateLastFetchTime() {
    const progressCounter = document.getElementById('progressCounter');
    if (progressCounter) {
        const lastFetch = new Date().toLocaleString();
        progressCounter.style.display = 'block';
        progressCounter.innerHTML = `Total Contacts: <span id="contactCount">${document.getElementById('contactCount')?.textContent || '0'}</span><br>Last updated: ${lastFetch}`;
    }
}

// Update the showConversationActions function to set the correct button text
function showConversationActions(username) {
  document.getElementById('conversationActions').style.display = 'flex';
  document.getElementById('currentConversation').style.display = 'block';
  document.getElementById('currentConversation').textContent = `Conversation with ${username}`;
}

// Update the handleConversationExtracted function to correctly generate and store HTML
function handleConversationExtracted(data, message) {
  updateStatus(message || 'Conversation extracted successfully!');
  hideProgressBar();
  
  // Extract username from message
  const usernameMatch = message?.match(/Conversation with (.+) extracted successfully!/);
  const username = usernameMatch ? usernameMatch[1] : '';
  
  // Update and show current conversation
  const currentConversationDiv = document.getElementById('currentConversation');
  if (currentConversationDiv && username) {
    currentConversationDiv.textContent = `Conversation with ${username}`;
    currentConversationDiv.style.display = 'block';
    
    // Store current conversation info
    chrome.storage.local.set({ 
      currentConversationUsername: username,
      lastExtractedTime: Date.now()
    });
  }
  
  // Show conversation actions
  const actionsDiv = document.getElementById('conversationActions');
  actionsDiv.style.display = 'block';

  // Display attachments using the displayAttachments function
  if (data && data.messages) {
    displayAttachments(data.messages).catch(console.error);
  }

  // Count attachments
  let attachmentCount = 0;
  if (data && data.messages) {
    for (const message of data.messages) {
      if (message.attachments && message.attachments.length > 0) {
        attachmentCount += message.attachments.length;
      }
    }
  }
  
  // Update the attachments button text and count
  const viewAttachmentsBtn = document.getElementById('viewAttachmentsBtn');
  const attachmentsCount = document.getElementById('attachmentsCount');
  
  if (viewAttachmentsBtn) {
    viewAttachmentsBtn.innerHTML = viewAttachmentsLabel(attachmentCount);
    viewAttachmentsBtn.style.display = attachmentCount > 0 ? 'flex' : 'none';
  }
  
  if (attachmentsCount) {
    attachmentsCount.textContent = attachmentCount.toString();
  }

  // First store the conversation data
  chrome.storage.local.set({ 
    conversationData: data,
    jsonContent: data,
    currentUsername: data.username || 'user'
  });
  
  // Then convert and store the markdown and HTML content
  convertToMarkdown(data)
    .then(convertedData => {
      // Now store the markdown and HTML content
      chrome.storage.local.set({ 
        markdownContent: convertedData.markdown,
        htmlContent: convertedData.html
      });
      console.log('HTML content saved successfully');
    })
    .catch(error => {
      console.error('Error converting conversation formats:', error);
      showNotification('error', 'Format Conversion Failed', 'Could not generate HTML and Markdown. The JSON data is still available.');
    });
}

// Add exportStatusInterval declaration near the top of the file with other global variables
// Add status checking functionality
let statusCheckInterval = null;
let exportStatusInterval = null;
let hasCheckedExportStatus = false;

function updateUIWithStatus(status) {
    const contactsStatus = status?.contacts;
    const conversationStatus = status?.conversations;

    // Update contacts UI
    if (contactsStatus) {
        const contactsButton = document.getElementById('fetchContactsButton');
        const contactsProgress = document.getElementById('contactsProgress');
        
        if (contactsStatus.status === 'running') {
            contactsButton.disabled = true;
            contactsProgress.textContent = contactsStatus.progress || 'Processing...';
            contactsProgress.style.display = 'block';
        } else if (contactsStatus.status === 'completed') {
            contactsButton.disabled = false;
            contactsProgress.textContent = contactsStatus.message || 'Completed!';
            setTimeout(() => {
                contactsProgress.style.display = 'none';
            }, 3000);
        }
    }

    // Update conversation UI
    if (conversationStatus) {
        const extractButton = document.getElementById('extractButton');
        const extractionProgress = document.getElementById('extractionProgress');
        
        if (conversationStatus.status === 'running') {
            extractButton.disabled = true;
            extractionProgress.textContent = conversationStatus.progress || 'Processing...';
            extractionProgress.style.display = 'block';
        } else if (conversationStatus.status === 'completed') {
            extractButton.disabled = false;
            extractionProgress.textContent = conversationStatus.message || 'Completed!';
            setTimeout(() => {
                extractionProgress.style.display = 'none';
            }, 3000);
        } else if (conversationStatus.status === 'error') {
            extractButton.disabled = false;
            extractionProgress.textContent = `Error: ${conversationStatus.error}`;
            extractionProgress.style.display = 'block';
        }
    }
}

function startStatusChecking() {
    if (statusCheckInterval) return;
    
    // Check status immediately
    chrome.runtime.sendMessage({ type: 'GET_PROCESS_STATUS' }, updateUIWithStatus);
    
    // Then check every 2 seconds
    statusCheckInterval = setInterval(() => {
        chrome.runtime.sendMessage({ type: 'GET_PROCESS_STATUS' }, updateUIWithStatus);
    }, 2000);
}

function stopStatusChecking() {
    if (statusCheckInterval) {
        clearInterval(statusCheckInterval);
        statusCheckInterval = null;
    }
}

// Update the convertToMarkdown function to pass the current username
async function convertToMarkdown(data) {
  return new Promise((resolve, reject) => {
    // Get the current conversation username
    chrome.storage.local.get(['currentUsername'], function(result) {
      // Add the currentUsername to the data object
      const dataWithUsername = {
        ...data,
        currentUsername: result.currentUsername
      };
      
      chrome.runtime.sendMessage(
        { 
          type: 'CONVERT_FORMATS', 
          data: dataWithUsername
        },
        function(response) {
          if (chrome.runtime.lastError) {
            console.error('Error converting formats:', chrome.runtime.lastError);
            reject(chrome.runtime.lastError);
          } else if (response && response.success) {
            resolve({
              markdown: response.markdown,
              html: response.html
            });
          } else {
            reject(new Error('Failed to convert formats'));
          }
        }
      );
    });
  });
}

// Settings modal handlers
function initializeSettings() {
  const settingsBtn = document.getElementById('settingsBtn');
  const settingsModal = document.getElementById('settingsModal');
  const modalBackdrop = document.getElementById('modalBackdrop');
  const cancelBtn = document.getElementById('cancelBtn');
  const saveBtn = document.getElementById('saveBtn');
  const dateFormatSelect = document.getElementById('dateFormat');
  const attachmentSortSelect = document.getElementById('attachmentSort');

  // Load current settings
  chrome.storage.local.get(['dateFormat', 'attachmentSort'], function(result) {
    const savedFormat = result.dateFormat || 'DD/MM/YYYY';
    dateFormatSelect.value = savedFormat;
    
    const savedSort = result.attachmentSort || 'newest';
    attachmentSortSelect.value = savedSort;
    
    // Set defaults if not set
    if (!result.dateFormat) {
      chrome.storage.local.set({ dateFormat: savedFormat });
    }
    
    if (!result.attachmentSort) {
      chrome.storage.local.set({ attachmentSort: savedSort });
    }
  });

  // Show modal
  settingsBtn.addEventListener('click', () => {
    settingsModal.style.display = 'block';
    modalBackdrop.style.display = 'block';
  });

  // Hide modal
  function hideModal() {
    settingsModal.style.display = 'none';
    modalBackdrop.style.display = 'none';
  }

  cancelBtn.addEventListener('click', hideModal);
  modalBackdrop.addEventListener('click', hideModal);

  // Save settings
  saveBtn.addEventListener('click', async () => {
    const newFormat = dateFormatSelect.value;
    const newSortOrder = attachmentSortSelect.value;
    
    chrome.storage.local.set({ 
      dateFormat: newFormat,
      attachmentSort: newSortOrder 
    }, async () => {
      // Show confirmation
      showNotification('success', 'Settings Saved', 'Your preferences have been updated.');
      
      // Refresh conversation display if we have data
      chrome.storage.local.get(['conversationData', 'currentUsername'], async function(result) {
        if (result.conversationData) {
          // Re-process the conversation data with new format
          const processedData = {
            ...result.conversationData,
            messages: await Promise.all(result.conversationData.messages.map(async msg => ({
              ...msg,
              formattedTime: await formatDate(msg.createdAt),
              repliedToMessage: msg.repliedToMessage ? {
                ...msg.repliedToMessage,
                formattedTime: await formatDate(msg.repliedToMessage.createdAt)
              } : null
            })))
          };

          // Generate new markdown with updated format
          const newMarkdown = await convertToMarkdown(processedData);

          // Update storage with new formatted data
          chrome.storage.local.set({
            conversationData: processedData,
            markdownContent: newMarkdown.markdown,
            jsonContent: processedData,
            htmlContent: newMarkdown.html,
          }, () => {
            // After storage is updated, refresh the UI
            // If attachments are currently displayed, refresh them with new sort order
            const attachmentsContainer = document.getElementById('attachments');
            if (attachmentsContainer && attachmentsContainer.style.display !== 'none') {
            displayAttachments(processedData.messages);
            }
            
            // Force reload of markdown content if it's currently viewed
            if (result.markdownContent) {
              // Create HTML wrapper for markdown content
              const htmlContent = createMarkdownViewerHTML(newMarkdown.markdown);
              const blob = new Blob([htmlContent], { type: 'text/html' });
              const existingMarkdownTab = document.querySelector('a[href*="markdown"]');
              if (existingMarkdownTab) {
                existingMarkdownTab.href = URL.createObjectURL(blob);
              }
            }
          });
        }
      });
      
      // Refresh contacts display
      chrome.storage.local.get(['allContacts'], function(result) {
        if (result.allContacts) {
          displayContacts(result.allContacts);
        }
      });

      hideModal();
    });
  });
}

// Initialize popup
document.addEventListener('DOMContentLoaded', () => {
  // Reset the notification tracking flag when popup opens
  hasCheckedExportStatus = false;
  
  // Initialize connection with background script
  chrome.runtime.sendMessage({ type: 'INIT_POPUP' });

  // Check if we're on a Fiverr page
  chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    const currentUrl = tabs[0].url;
    if (currentUrl.includes('fiverr.com')) {
      updateStatus('Ready to extract Fiverr data.');
      
      // Get any existing conversation data
      chrome.storage.local.get(['conversationData', 'currentUsername'], function(result) {
        if (result.conversationData) {
          if (result.currentUsername) {
            showConversationActions(result.currentUsername);
          }
        }
      });
      
      // Check if there's an ongoing bulk export
      checkBulkExportStatus();
    } else {
      updateStatus('Please navigate to Fiverr to use this extension.', true);
    }
  });

  // Load current conversation if exists
  chrome.storage.local.get(['currentConversationUsername', 'lastExtractedTime'], function(result) {
    if (result.currentConversationUsername) {
      const currentConversationDiv = document.getElementById('currentConversation');
      if (currentConversationDiv) {
        currentConversationDiv.textContent = `Conversation with ${result.currentConversationUsername}`;
        currentConversationDiv.style.display = 'block';
        
        // Show conversation actions
        const actionsDiv = document.getElementById('conversationActions');
        actionsDiv.style.display = 'block';
      }
    }
  });

  // Fetch Contacts button click handler
  document.getElementById('fetchContactsBtn').addEventListener('click', function() {
    // Clear any existing notifications
    clearAllNotifications();
    
    // Hide the progress log completely
    document.getElementById('progressLog').style.display = 'none';
    
    // Show only the counter, not the full log
      document.getElementById('progressCounter').style.display = 'block';
      document.getElementById('contactCount').textContent = '0';
    
    showProgressBar(); // Initialize progress bar
    updateProgress(5, 'Starting...'); 
      
      updateStatus('Fetching all contacts...', false, true);
      chrome.runtime.sendMessage({ type: 'FETCH_ALL_CONTACTS' });
  });

  // Extract button click handler
  document.getElementById('extractBtn').addEventListener('click', function() {
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      const tab = tabs[0];
      
      // Only allow extraction from specific inbox URL format
      const match = tab.url.match(/^https:\/\/www\.fiverr\.com\/inbox\/([^\/\?]+)$/);
      if (!match) {
        updateStatus('Please open a specific inbox URL (e.g., https://www.fiverr.com/inbox/username)', true);
        return;
      }

      const username = match[1];
      
      // Clear any existing notifications before starting
      clearAllNotifications();
      
      // Hide progress log
      document.getElementById('progressLog').style.display = 'none';
      
      showProgressBar(true); // Show indeterminate progress initially
          updateStatus(`Extracting conversation with ${username}...`, false, true);
      
      chrome.storage.local.set({ currentUsername: username }, function() {
          chrome.runtime.sendMessage({ type: 'EXTRACT_CONVERSATION' });
      });
    });
  });

  // Download button click handler
  document.getElementById('downloadBtn').addEventListener('click', () => {
    chrome.storage.local.get(['markdownContent', 'currentUsername'], function(result) {
      if (result.markdownContent && result.currentUsername) {
        const blob = new Blob([result.markdownContent], { type: 'text/markdown' });
        chrome.downloads.download({
          url: URL.createObjectURL(blob),
          filename: `${result.currentUsername}/conversations/fiverr_conversation_${result.currentUsername}_${new Date().toISOString().split('T')[0]}.md`,
          saveAs: false
        });
      } else {
        updateStatus('Please extract the conversation first.', true);
      }
    });
  });

  // Open in new tab button click handler
  document.getElementById('openBtn').addEventListener('click', () => {
    chrome.storage.local.get(['markdownContent'], function(result) {
      if (result.markdownContent) {
        // Create HTML wrapper for markdown content
        const htmlContent = createMarkdownViewerHTML(result.markdownContent);
        // Create a blob from the HTML content and open it in a new tab
        const blob = new Blob([htmlContent], { type: 'text/html' });
        chrome.tabs.create({ url: URL.createObjectURL(blob) });
      } else {
        updateStatus('Please extract the conversation first.', true);
      }
    });
  });

  // Download JSON button click handler
  document.getElementById('downloadJsonBtn').addEventListener('click', () => {
    chrome.storage.local.get(['jsonContent', 'currentUsername'], function(result) {
      if (result.jsonContent && result.currentUsername) {
        const blob = new Blob([JSON.stringify(result.jsonContent, null, 2)], { type: 'application/json' });
        chrome.downloads.download({
          url: URL.createObjectURL(blob),
          filename: `${result.currentUsername}/conversations/${result.currentUsername}_conversation.json`,
          saveAs: false
        });
      } else {
        updateStatus('Please extract the conversation first.', true);
      }
    });
  });

  // View JSON button click handler
  document.getElementById('viewJsonBtn').addEventListener('click', () => {
    chrome.storage.local.get(['jsonContent'], function(result) {
      if (result.jsonContent) {
        const blob = new Blob([JSON.stringify(result.jsonContent, null, 2)], { type: 'application/json' });
        chrome.tabs.create({ url: URL.createObjectURL(blob) });
      } else {
        updateStatus('Please extract the conversation first.', true);
      }
    });
  });

  // Load stored contacts when popup opens
  loadStoredContacts();
  
  // Start status checking
  startStatusChecking();
  
  // Initialize attachments button if there's stored conversation data
  chrome.storage.local.get(['conversationData'], function(result) {
    if (result.conversationData) {
      handleConversationExtracted(result.conversationData);
    }
  });

  // Initialize settings
  initializeSettings();

  // Update attachments button handler
  const viewAttachmentsBtn = document.getElementById('viewAttachmentsBtn');
  if (viewAttachmentsBtn) {
    viewAttachmentsBtn.addEventListener('click', toggleAttachmentsPanel);
  }

  // Update contacts button handler
  const toggleContactsBtn = document.getElementById('toggleContacts');
  if (toggleContactsBtn) {
    toggleContactsBtn.addEventListener('click', toggleContactsPanel);
  }

  // Bulk export button
  const bulkExportBtn = document.getElementById('bulkExportBtn');
  if (bulkExportBtn) {
    bulkExportBtn.addEventListener('click', openBulkExportModal);
  }
  
  // Close bulk export modal
  const closeBulkExport = document.getElementById('closeBulkExport');
  if (closeBulkExport) {
    closeBulkExport.addEventListener('click', closeBulkExportModal);
  }
  
  // Start export button
  const exportButton = document.getElementById('exportButton');
  if (exportButton) {
    exportButton.addEventListener('click', startBulkExport);
  }

  // Download all attachments as ZIP
  const downloadAllZipBtn = document.getElementById('downloadAllZipBtn');
  if (downloadAllZipBtn) {
    downloadAllZipBtn.addEventListener('click', function() {
      chrome.storage.local.get(['conversationData', 'currentUsername'], function(result) {
        if (!result.conversationData || !result.conversationData.messages) {
          showNotification('error', 'No Data', 'Please extract a conversation first.');
          return;
        }

        let attachments = [];
        for (const message of result.conversationData.messages) {
          if (message.attachments && message.attachments.length > 0) {
            for (const attachment of message.attachments) {
              if (attachment.downloadUrl) {
                attachments.push({
                  downloadUrl: attachment.downloadUrl,
                  filename: attachment.filename || attachment.file_name || 'unnamed_file'
                });
              }
            }
          }
        }

        if (attachments.length === 0) {
          showNotification('error', 'No Attachments', 'This conversation has no attachments to download.');
          return;
        }

        const statusEl = document.getElementById('attachZipStatus');
        if (statusEl) {
          statusEl.textContent = 'Preparing ZIP with ' + attachments.length + ' attachments...';
          statusEl.style.display = 'block';
        }
        downloadAllZipBtn.disabled = true;

        chrome.runtime.sendMessage({
          type: 'DOWNLOAD_ALL_ATTACHMENTS_ZIP',
          username: result.currentUsername || 'conversation',
          attachments: attachments
        }, function(response) {
          if (chrome.runtime.lastError) {
            console.error('Error sending ZIP request:', chrome.runtime.lastError);
            showNotification('error', 'ZIP Error', chrome.runtime.lastError.message);
            downloadAllZipBtn.disabled = false;
            if (statusEl) statusEl.style.display = 'none';
          }
        });
      });
    });
  }

  // Download conversation + attachments as ZIP
  const downloadConvWithAttachBtn = document.getElementById('downloadConvWithAttachBtn');
  if (downloadConvWithAttachBtn) {
    downloadConvWithAttachBtn.addEventListener('click', function() {
      chrome.storage.local.get(['conversationData', 'currentUsername'], function(result) {
        if (!result.conversationData || !result.conversationData.messages) {
          showNotification('error', 'No Data', 'Please extract a conversation first.');
          return;
        }

        const allChecked = Array.from(document.querySelectorAll('.conv-zip-format-cb:checked')).map(cb => cb.value);
        const includeAttachments = allChecked.includes('attachments');
        const formats = allChecked.filter(f => f !== 'attachments');
        if (formats.length === 0 && !includeAttachments) {
          showNotification('error', 'No Format Selected', 'Please select at least one format to include in the ZIP.');
          return;
        }
        const username = result.currentUsername || 'conversation';

        const statusEl = document.getElementById('convZipStatus');
        if (statusEl) {
          statusEl.textContent = 'Preparing download...';
          statusEl.style.display = 'block';
        }
        downloadConvWithAttachBtn.disabled = true;

        chrome.runtime.sendMessage({
          type: 'DOWNLOAD_CONVERSATION_WITH_ATTACHMENTS_ZIP',
          username: username,
          format: formats,
          includeAttachments: includeAttachments
        }, function(response) {
          if (chrome.runtime.lastError) {
            console.error('Error sending ZIP request:', chrome.runtime.lastError);
            showNotification('error', 'ZIP Error', chrome.runtime.lastError.message);
            downloadConvWithAttachBtn.disabled = false;
            if (statusEl) statusEl.style.display = 'none';
          }
        });
      });
    });
  }
});

// Handle messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.type) {
    case 'CONTACTS_PROGRESS':
      updateStatus(request.message, request.isError, true);
      // Removed: addLogEntry(request.message, request.isError);
      
      // Use direct percentage information if available
      if (typeof request.percentComplete === 'number') {
        updateProgress(request.percentComplete, 
          request.totalContacts ? `${request.totalContacts} contacts` : `Batch ${request.batch || '?'}`);
      } 
      // Fallback to estimated percentage
      else {
        // Extract progress information if available in the message
        const progressMatch = request.message.match(/Total: (\d+)/);
        if (progressMatch && progressMatch[1]) {
          const totalSoFar = parseInt(progressMatch[1]);
          const estimatedTotal = Math.max(100, totalSoFar * 1.2); // Assume we're about 80% done
          const percent = Math.min(95, Math.floor((totalSoFar / estimatedTotal) * 100));
          updateProgress(percent, `${totalSoFar} contacts`);
        }
      }
      
      // Update the contact counter
      if (request.totalContacts) {
        updateContactCounter(request.totalContacts);
      }
      
      // Only show error notifications, not progress ones
      if (request.isError) {
        showNotification('error', 'Error', request.message, 5000);
      }
      
      return true;
    
    case 'CONTACTS_FETCHED':
      updateStatus(request.message);
      // Removed: addLogEntry(request.message);
      updateProgress(100, 'Complete!');
      
      // Complete the progress and hide it after a short delay
      setTimeout(() => {
        hideProgressBar();
        
        // Don't show notification at all
        // Removed: showNotification(...);
        
      }, 1000);
      
        displayContacts(request.data).catch(console.error);
        updateContactCounter(request.data.length);
      updateLastFetchTime();
      return true;
    
    case 'CONVERSATION_EXTRACTED':
      handleConversationExtracted(request.data, request.message);
      break;
    
    case 'EXTRACTION_ERROR':
      updateStatus(request.error, true);
      // Removed: addLogEntry(request.error, true);
      hideProgressBar();
      
      // Show only one error notification
      showNotification(
        'error',
        'Extraction Failed',
        request.error,
        7000 // Still show errors for slightly longer
      );
      return true;
    
    // Handle extraction progress with enhanced information
    case 'EXTRACTION_PROGRESS':
      updateStatus(request.message, false, true);
      // Removed: addLogEntry(request.message);
      
      // Use direct percentage if available
      if (typeof request.percentComplete === 'number') {
        updateProgress(
          request.percentComplete, 
          `Batch ${request.currentBatch || '?'}/${request.estimatedTotalBatches || '?'}`
        );
      }
      // Otherwise try to extract batch info from the message
      else {
        const batchMatch = request.message.match(/batch (\d+)/i);
        if (batchMatch && batchMatch[1]) {
          const currentBatch = parseInt(batchMatch[1]);
          // We don't know the total batches, so estimate
          const estimatedBatches = Math.max(10, currentBatch + 2);
          const percent = Math.min(90, Math.floor((currentBatch / estimatedBatches) * 100));
          updateProgress(percent, `Batch ${currentBatch}`);
        } else {
          // If we can't parse batch info, just show indeterminate progress
          showProgressBar(true);
        }
      }
      
      // No notifications for progress updates

      return true;

    case 'ATTACHMENT_ZIP_PROGRESS': {
      const statusEl = document.getElementById('attachZipStatus');
      if (statusEl) {
        statusEl.textContent = request.message || ('Downloading attachment ' + request.current + ' of ' + request.total + '...');
        statusEl.style.display = 'block';
      }
      return true;
    }

    case 'ATTACHMENT_ZIP_COMPLETE': {
      const btn = document.getElementById('downloadAllZipBtn');
      const statusEl = document.getElementById('attachZipStatus');
      if (btn) btn.disabled = false;
      if (statusEl) {
        statusEl.textContent = request.message || 'ZIP download complete!';
        setTimeout(function() { statusEl.style.display = 'none'; }, 3000);
      }
      showNotification('success', 'ZIP Ready', request.message || 'Attachments ZIP downloaded successfully.');
      return true;
    }

    case 'ATTACHMENT_ZIP_ERROR': {
      const btn = document.getElementById('downloadAllZipBtn');
      const statusEl = document.getElementById('attachZipStatus');
      if (btn) btn.disabled = false;
      if (statusEl) statusEl.style.display = 'none';
      showNotification('error', 'ZIP Error', request.message || 'Failed to create attachments ZIP.');
      return true;
    }

    case 'CONV_ZIP_PROGRESS': {
      const statusEl = document.getElementById('convZipStatus');
      if (statusEl) {
        statusEl.textContent = request.message || ('Processing ' + request.current + ' of ' + request.total + '...');
        statusEl.style.display = 'block';
      }
      return true;
    }

    case 'CONV_ZIP_COMPLETE': {
      const btn = document.getElementById('downloadConvWithAttachBtn');
      const statusEl = document.getElementById('convZipStatus');
      if (btn) btn.disabled = false;
      if (statusEl) {
        statusEl.textContent = request.message || 'ZIP download complete!';
        setTimeout(function() { statusEl.style.display = 'none'; }, 3000);
      }
      showNotification('success', 'ZIP Ready', request.message || 'Conversation + attachments ZIP downloaded successfully.');
      return true;
    }

    case 'CONV_ZIP_ERROR': {
      const btn = document.getElementById('downloadConvWithAttachBtn');
      const statusEl = document.getElementById('convZipStatus');
      if (btn) btn.disabled = false;
      if (statusEl) statusEl.style.display = 'none';
      showNotification('error', 'ZIP Error', request.message || 'Failed to create conversation ZIP.');
      return true;
    }
  }
});

// Stop checking when popup closes
window.addEventListener('unload', () => {
  stopStatusChecking();
});

// Add a function to clear all notifications
function clearAllNotifications() {
  // Create a copy of the set before iterating to avoid modification during iteration
  const notificationIds = [...activeNotifications];
  for (const id of notificationIds) {
    removeNotification(id);
  }
  
  // Also reset the type tracking
  for (const type in activeNotificationsByType) {
    activeNotificationsByType[type] = null;
  }
}

// Add bulk export functions
let selectedContactsForExport = new Set();

function openBulkExportModal() {
  const modal = document.getElementById('bulkExportModal');
  const mainContainer = document.querySelector('.main-container');
  
  // Add show class to animate the panel
  modal.style.display = 'block';
  setTimeout(() => {
    modal.classList.add('show');
    mainContainer.classList.add('with-bulk-export');
  }, 10);
  
  // Populate contacts
  populateContactsForExport();
}

function closeBulkExportModal() {
  const modal = document.getElementById('bulkExportModal');
  const mainContainer = document.querySelector('.main-container');
  
  // Remove show class to animate the panel
  modal.classList.remove('show');
  mainContainer.classList.remove('with-bulk-export');
  
  // Hide after animation
  setTimeout(() => {
    modal.style.display = 'none';
  }, 300);
  
  // Reset the modal to its initial state
  document.getElementById('exportProgress').style.display = 'none';
  document.getElementById('exportButton').disabled = false;
  
  // Stop checking for export status updates
  stopExportStatusChecking();
}

function populateContactsForExport() {
  const contactsSelection = document.getElementById('contactsSelection');
  contactsSelection.innerHTML = '';
  
  // Get stored contacts
  chrome.storage.local.get(['allContacts'], function(result) {
    const contacts = result.allContacts || [];
    
    if (contacts.length === 0) {
      contactsSelection.innerHTML = '<div class="no-contacts">No contacts found. Please fetch contacts first.</div>';
      document.getElementById('exportButton').disabled = true;
      return;
    }
    
    // Enable the export button
    document.getElementById('exportButton').disabled = false;
    
    // Clear the selected contacts
    selectedContactsForExport.clear();
    
    // Create a checkbox for each contact
    contacts.forEach(contact => {
      const username = contact.username || 'Unknown User';
      
      const contactItem = document.createElement('div');
      contactItem.className = 'contact-checkbox-item';
      
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = `export-contact-${username}`;
      checkbox.dataset.username = username;
      checkbox.className = 'contact-export-checkbox';
      
      checkbox.addEventListener('change', function() {
        if (this.checked) {
          selectedContactsForExport.add(username);
        } else {
          selectedContactsForExport.delete(username);
        }
        
        // Update the "Select All" checkbox
        updateSelectAllCheckbox();
      });
      
      const label = document.createElement('label');
      label.className = 'contact-select-label';
      label.htmlFor = `export-contact-${username}`;
      label.textContent = username;
      
      contactItem.appendChild(checkbox);
      contactItem.appendChild(label);
      contactsSelection.appendChild(contactItem);
    });
    
    // Setup the "Select All" checkbox behavior
    setupSelectAllContactsExport();
  });
}

function updateSelectAllCheckbox() {
  const allCheckboxes = document.querySelectorAll('.contact-export-checkbox');
  const selectAllCheckbox = document.getElementById('selectAllContactsExport');
  
  if (allCheckboxes.length === selectedContactsForExport.size) {
    selectAllCheckbox.checked = true;
    selectAllCheckbox.indeterminate = false;
  } else if (selectedContactsForExport.size === 0) {
    selectAllCheckbox.checked = false;
    selectAllCheckbox.indeterminate = false;
  } else {
    selectAllCheckbox.indeterminate = true;
  }
}

function setupSelectAllContactsExport() {
  const selectAllCheckbox = document.getElementById('selectAllContactsExport');
  
  selectAllCheckbox.addEventListener('change', function() {
    const allCheckboxes = document.querySelectorAll('.contact-export-checkbox');
    
    allCheckboxes.forEach(checkbox => {
      checkbox.checked = this.checked;
      
      if (this.checked) {
        selectedContactsForExport.add(checkbox.dataset.username);
      } else {
        selectedContactsForExport.delete(checkbox.dataset.username);
      }
    });
  });
}

async function startBulkExport() {
  // Check if an export is already running
  let exportAlreadyRunning = false;
  
  try {
    const statusResponse = await new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'GET_BULK_EXPORT_STATUS' }, status => {
        resolve(status);
      });
    });
    
    if (statusResponse && statusResponse.status === 'running') {
      document.getElementById('exportStatus').textContent = 'An export is already running. Please wait for it to complete.';
      // Update UI to reflect current status
      document.getElementById('exportButton').disabled = true;
      document.getElementById('exportProgress').style.display = 'block';
      startExportStatusChecking();
      return;
    }
  } catch (err) {
    console.error("Error checking export status:", err);
  }
  
  // Validate that at least one contact is selected
  if (selectedContactsForExport.size === 0) {
    document.getElementById('exportStatus').textContent = 'Please select at least one contact.';
    return;
  }
  
  // Get export options
  const format = document.getElementById('exportFormat').value;
  const includeAttachments = document.getElementById('includeAttachments').checked;
  
  try {
    // Get the active tab
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0];
    
    // Validate that we have an active Fiverr tab
    if (!activeTab || !activeTab.url || !activeTab.url.includes('fiverr.com')) {
      throw new Error('Please open Fiverr in the active tab before starting the export.');
    }
    
    // Disable the export button and show progress
    document.getElementById('exportButton').disabled = true;
    document.getElementById('exportProgress').style.display = 'block';
    document.getElementById('exportStatus').textContent = 'Starting export in background...';
    
    // Convert Set to Array for easier processing
    const contactsToExport = Array.from(selectedContactsForExport).map(username => {
      return { username };
    });
    
    // Send the export request to the background script
    chrome.runtime.sendMessage({
      type: 'START_BULK_EXPORT',
      contacts: contactsToExport,
      format: format,
      includeAttachments: includeAttachments,
      tabId: activeTab.id
    }, response => {
      if (chrome.runtime.lastError) {
        console.error('Runtime error:', chrome.runtime.lastError);
        document.getElementById('exportStatus').textContent = 'Failed to start export: ' + chrome.runtime.lastError.message;
        document.getElementById('exportButton').disabled = false;
        return;
      }
      
      console.log('Bulk export started:', response);
      
      if (response && response.success) {
        document.getElementById('exportStatus').textContent = 'Export running in background. You can close this popup.';
        
        // Start a timer to check status initially
        startExportStatusChecking();
      } else {
        const errorMsg = response?.message || 'Failed to start export. Please try again.';
        document.getElementById('exportStatus').textContent = errorMsg;
        document.getElementById('exportButton').disabled = false;
      }
    });
  } catch (error) {
    console.error('Error starting bulk export:', error);
    document.getElementById('exportStatus').textContent = `Error: ${error.message}`;
    document.getElementById('exportButton').disabled = false;
  }
}

// Update the export status checking function to use the flag
function startExportStatusChecking() {
  // Reset interval if already running
  if (exportStatusInterval) {
    clearInterval(exportStatusInterval);
  }
  
  // Check status immediately (this first check will use the isFirstCheck flag)
  checkBulkExportStatus();
  
  // Subsequent checks in the interval should not show notifications on status changes
  // Create a regular interval check
  exportStatusInterval = setInterval(() => {
    // Set the flag to false explicitly for interval checks
    hasCheckedExportStatus = true;
    checkBulkExportStatus();
  }, 2000);
}

// Add message listener for FETCH_CONVERSATION_FOR_EXPORT
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  console.log("Popup received message:", request.type);
  
  if (request.type === 'FETCH_CONVERSATION_FOR_EXPORT_RESPONSE') {
    console.log("Received FETCH_CONVERSATION_FOR_EXPORT_RESPONSE in global listener:", request);
    // The individual request listeners will handle this message
    if (request.waitingForResponse) {
      sendResponse({ received: true });
    }
    return true;
  }
});

// Function to check the status of any ongoing bulk export
function checkBulkExportStatus() {
  // Track whether this is the first check after popup opens
  const isFirstCheck = !hasCheckedExportStatus;
  hasCheckedExportStatus = true;
  
  chrome.runtime.sendMessage({ type: 'GET_BULK_EXPORT_STATUS' }, status => {
    if (status && status.status) {
      console.log('Current bulk export status:', status);
      
      // Update the main panel progress indicator regardless of status
      updateMainPanelExportProgress(status);
      
      // If there's an active export, show the export modal with current status
      if (status.status === 'running') {
        // Open the bulk export modal
        document.getElementById('bulkExportModal').style.display = 'block';
        
        // Show the progress section
        const exportProgress = document.getElementById('exportProgress');
        exportProgress.style.display = 'block';
        
        // Update the progress bar
        const progressBar = document.getElementById('exportProgressBar');
        const progressLabel = document.getElementById('exportProgressLabel');
        const statusElement = document.getElementById('exportStatus');
        
        progressBar.style.width = `${status.progress}%`;
        progressLabel.textContent = `${status.progress}%`;
        
        // Disable the export button
        document.getElementById('exportButton').disabled = true;
        
        // Update status message
        let statusMessage = `Export in progress: ${status.completed} of ${status.total} conversations exported.`;
        if (status.current) {
          statusMessage += ` Currently processing: ${status.current}`;
        }
        statusMessage += ' You can close this popup and the export will continue in the background.';
        statusElement.textContent = statusMessage;
        
        // Start checking for updates
        startExportStatusChecking();
        
        // If we have contacts data, populate the contacts selection
        if (status.contacts && status.contacts.length > 0) {
          // Populate the contacts selection with the current export contacts
          const contactsSelection = document.getElementById('contactsSelection');
          contactsSelection.innerHTML = '';
          
          // Create a Set of selected usernames for easy lookup
          const selectedUsernames = new Set(status.contacts.map(contact => contact.username));
          
          // Update the global selectedContactsForExport Set
          selectedContactsForExport = selectedUsernames;
        }
      } 
      // Only show completed/error notifications if:
      // 1. It's not the first check after popup opens (to avoid notification on every reopen)
      // 2. The status is recent (completed in the last 5 minutes)
      else if (!isFirstCheck && status.timestamp && (Date.now() - status.timestamp < 300000)) {
        // If the export just completed, show a notification
        if (status.status === 'completed') {
          // Show a notification if the export completed in the last 5 minutes
          showNotification('success', 'Bulk Export Completed', 
            `Successfully exported ${status.completed} conversations.`);
        }
        // If there was an error, show a notification
        else if (status.status === 'error') {
          // Show a notification if the error occurred in the last 5 minutes
          showNotification('error', 'Bulk Export Error', 
            status.message || 'An error occurred during the bulk export.');
        }
      }
    }
  });
}

// Function to update the main panel export progress
function updateMainPanelExportProgress(status) {
  const bulkExportProgress = document.getElementById('bulkExportProgress');
  const mainPanelExportProgress = document.getElementById('mainPanelExportProgress');
  const mainPanelExportStatus = document.getElementById('mainPanelExportStatus');
  
  if (!status || !status.status) {
    // No active export, hide the progress indicator
    bulkExportProgress.style.display = 'none';
    return;
  }
  
  // Show the progress indicator
  bulkExportProgress.style.display = 'block';
  
  // Ensure counts are valid and don't exceed total
  let completed = status.completed;
  const total = status.total;
  
  if (completed > total) {
    console.warn(`Display count mismatch: completed (${completed}) > total (${total}). Fixing count.`);
    completed = total;
  }
  
  // Update the progress bar
  mainPanelExportProgress.style.width = `${status.progress}%`;
  
  // Update the status text based on the export status
  if (status.status === 'running') {
    mainPanelExportStatus.textContent = `Exporting: ${completed}/${total} (${status.progress}%)`;
    // Make the Bulk Export button look active
    document.getElementById('bulkExportBtn').style.backgroundColor = '#1976d2';
  } else if (status.status === 'completed') {
    mainPanelExportStatus.textContent = `Export completed: ${completed} conversation${completed !== 1 ? 's' : ''}`;
    // Reset the button color after a delay
    setTimeout(() => {
      document.getElementById('bulkExportBtn').style.backgroundColor = '';
      // Hide the progress after showing completion for a while
      if (Date.now() - status.timestamp > 60000) { // Hide after 1 minute
        bulkExportProgress.style.display = 'none';
      }
    }, 5000);
  } else if (status.status === 'error') {
    mainPanelExportStatus.textContent = 'Export error: ' + (status.message || 'Unknown error');
    // Reset the button color
    document.getElementById('bulkExportBtn').style.backgroundColor = '';
  }
}

// Update the HTML download button handler to add debug logging and success notification
document.getElementById('downloadHtmlBtn').addEventListener('click', function() {
  chrome.storage.local.get(['htmlContent', 'currentUsername'], function(result) {
    console.log('HTML download clicked, content available:', !!result.htmlContent);
    
    if (result.htmlContent) {
      const blob = new Blob([result.htmlContent], {type: 'text/html'});
      const url = URL.createObjectURL(blob);
      const username = result.currentUsername || 'conversation';
      
      chrome.downloads.download({
        url: url,
        filename: `fiverr-conversations/${username}/${username}.html`,
        conflictAction: 'uniquify'
      }, function(downloadId) {
        if (chrome.runtime.lastError) {
          console.error('Download error:', chrome.runtime.lastError);
          updateStatus('Error downloading HTML: ' + chrome.runtime.lastError.message, true);
        } else {
          console.log('HTML downloaded successfully, ID:', downloadId);
          showNotification('success', 'Download Complete', 'HTML conversation has been downloaded.');
        }
      });
    } else {
      console.error('No HTML content available');
      updateStatus('No HTML content available', true);
      showNotification('error', 'Download Failed', 'HTML content is not available. Please try extracting the conversation again.');
    }
  });
});

document.getElementById('viewHtmlBtn').addEventListener('click', function() {
  chrome.storage.local.get(['htmlContent'], function(result) {
    if (result.htmlContent) {
      const blob = new Blob([result.htmlContent], {type: 'text/html'});
      const url = URL.createObjectURL(blob);
      
      // Open the HTML in a new tab
      chrome.tabs.create({ url: url });
    } else {
      updateStatus('No HTML content available', true);
    }
  });
});

// Function to stop export status checking
function stopExportStatusChecking() {
  if (exportStatusInterval) {
    clearInterval(exportStatusInterval);
    exportStatusInterval = null;
  }
}

// Function to wrap markdown content in HTML with line numbers
function createMarkdownViewerHTML(markdownContent) {
  const escapedContent = markdownContent
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
  
  const lines = escapedContent.split('\n');
  const numberedLines = lines.map((line, index) => 
    `<div class="line"><span class="line-number">${index + 1}</span><span class="line-content">${line}</span></div>`
  ).join('');
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Markdown Content</title>
  <style>
    body {
      font-family: monospace;
      margin: 0;
      padding: 20px;
      background-color: #f5f5f5;
      color: #333;
    }
    .code-container {
      display: flex;
      overflow-x: auto;
      background-color: white;
      border: 1px solid #ddd;
      border-radius: 4px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
      padding: 10px 0;
    }
    .lines-container {
      flex: 1;
      font-family: Consolas, Monaco, 'Andale Mono', 'Ubuntu Mono', monospace;
      white-space: pre;
      line-height: 1.5;
      font-size: 14px;
      display: table;
      width: 100%;
    }
    .line {
      display: table-row;
    }
    .line-number {
      display: table-cell;
      min-width: 40px;
      padding-right: 12px;
      text-align: right;
      color: #999;
      user-select: none;
      -webkit-user-select: none;
      -moz-user-select: none;
      -ms-user-select: none;
      border-right: 1px solid #ddd;
      vertical-align: top;
      position: sticky;
      left: 0;
      background: white;
    }
    .line-content {
      display: table-cell;
      white-space: pre;
      padding-left: 12px;
      user-select: text;
      -webkit-user-select: text;
      -moz-user-select: text;
      -ms-user-select: text;
    }
    .line-content:hover {
      background-color: #f8f9fa;
    }
  </style>
</head>
<body>
  <div class="code-container">
    <div class="lines-container">
${numberedLines}
    </div>
  </div>
</body>
</html>`;
}
