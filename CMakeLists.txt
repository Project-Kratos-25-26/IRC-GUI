cmake_minimum_required(VERSION 3.8)
project(irc_gui)

if(CMAKE_COMPILER_IS_GNUCXX OR CMAKE_CXX_COMPILER_ID MATCHES "Clang")
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

# Find dependencies
find_package(ament_cmake REQUIRED)

# Install Python Executables
install(
  PROGRAMS
  irc_gui/scripts/start_drive.sh
  irc_gui/scripts/start_ld.sh
  irc_gui/scripts/start_arm.sh
  irc_gui/scripts/switch_mode.sh
  irc_gui/scripts/servo.sh
  DESTINATION scripts
  DESTINATION lib/${PROJECT_NAME}
)

# Install Directories (Launch files, Configs, and the Website)
install(
  DIRECTORY irc_gui
  DESTINATION share/${PROJECT_NAME}
)

ament_package()